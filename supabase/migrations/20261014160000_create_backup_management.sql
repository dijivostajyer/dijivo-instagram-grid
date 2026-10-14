-- Yedekleme + Geri Yükleme Merkezi (Faz 6).
--
-- Yedek paketleri (ZIP) Supabase'de DEĞİL, sunucu dosya sisteminde
-- (BACKUP_DIR; public_html dışında) tutulur. Bu migration yalnız
-- yönetim meta verisini, kilidi ve atomik geri yükleme fonksiyonlarını
-- oluşturur:
--
--   backup_settings          tekil satır: otomatik yedek ayarı, saklama
--                            politikası ve sunucu tarafı iş kilidi
--   backup_jobs              yedek/geri yükleme işleri (durum, boyut, hata)
--   backup_audit_events      ekleme-yalnız denetim kaydı (kim/ne/ne zaman)
--   backup_restore_staging   geri yükleme satırlarının geçici alanı
--   workspace_sync_state     geri yükleme "epoch"u: eski sekme/cihazların
--                            bayat yerel kopyayı buluta geri yazmasını önler
--
-- Erişim: backup_* tablolarına yalnız sunucu (service role) erişir; RLS açık,
-- policy yok. Fonksiyonların EXECUTE yetkisi yalnız service_role'dedir.
--
-- Geri yükleme atomikliği: PostgREST her isteği ayrı transaction'da çalıştırır
-- (çok adımlı istemci transaction'ı yoktur). Bu yüzden satırlar önce staging
-- tablosuna yazılır, ardından backup_apply_restore() TEK transaction içinde
-- silme (çocuk → ebeveyn) + ekleme (ebeveyn → çocuk) yapar. Herhangi bir
-- hata (FK, CHECK, sayı uyuşmazlığı) tüm değişikliği geri alır.
--
-- İdempotent: tekrar çalıştırılabilir. Production'a uygulanması ayrı karardır.

-- -----------------------------------------------------------------
-- 1. backup_settings (tekil satır + kilit)
-- -----------------------------------------------------------------

create table if not exists public.backup_settings (
  id boolean primary key default true check (id),
  auto_enabled boolean not null default true,
  -- Tam (DB + medya) yedek için en kısa aralık 15 dakikadır.
  interval_minutes integer not null default 1440,
  keep_last integer not null default 10,
  keep_daily_days integer not null default 7,
  keep_weekly_weeks integer not null default 4,
  keep_pre_restore_days integer not null default 14,
  lock_job_id uuid,
  lock_operation text,
  lock_acquired_at timestamptz,
  lock_heartbeat_at timestamptz,
  cron_last_seen_at timestamptz,
  last_unchanged_at timestamptz,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'backup_settings_interval_check') then
    alter table public.backup_settings add constraint backup_settings_interval_check
      check (interval_minutes in (15, 30, 60, 180, 360, 720, 1440, 10080));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'backup_settings_retention_check') then
    alter table public.backup_settings add constraint backup_settings_retention_check
      check (keep_last between 1 and 100 and keep_daily_days between 0 and 90
        and keep_weekly_weeks between 0 and 52 and keep_pre_restore_days between 1 and 90);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'backup_settings_lock_operation_check') then
    alter table public.backup_settings add constraint backup_settings_lock_operation_check
      check (lock_operation is null or lock_operation in ('backup', 'restore'));
  end if;
end
$$;

insert into public.backup_settings (id) values (true) on conflict (id) do nothing;

alter table public.backup_settings enable row level security;

-- -----------------------------------------------------------------
-- 2. backup_jobs
-- -----------------------------------------------------------------

create table if not exists public.backup_jobs (
  id uuid primary key default gen_random_uuid(),
  operation text not null,
  kind text not null,
  status text not null default 'running',
  actor text not null,
  actor_user_id uuid references auth.users (id) on delete set null,
  file_name text,
  size_bytes bigint,
  db_row_count integer,
  media_file_count integer,
  summary jsonb not null default '{}'::jsonb,
  source_backup_id uuid references public.backup_jobs (id) on delete set null,
  safety_backup_id uuid references public.backup_jobs (id) on delete set null,
  error_stage text,
  error_message text,
  started_at timestamptz not null default now(),
  heartbeat_at timestamptz,
  finished_at timestamptz,
  deleted_at timestamptz,
  deleted_by uuid references auth.users (id) on delete set null,
  deleted_reason text,
  constraint backup_jobs_operation_check check (operation in ('backup', 'restore')),
  constraint backup_jobs_kind_check check (
    (operation = 'backup' and kind in ('manual', 'scheduled', 'pre_restore'))
    or (operation = 'restore' and kind = 'restore')),
  constraint backup_jobs_status_check check (status in ('running', 'succeeded', 'failed')),
  constraint backup_jobs_actor_check check (actor in ('user', 'cron')),
  -- Dosya adı sunucuda üretilir; yol ayırıcı veya `..` içeremez.
  constraint backup_jobs_file_name_check check (
    file_name is null or file_name ~ '^backup-[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9]{6}-[0-9a-f]{8}\.zip$'),
  constraint backup_jobs_deleted_reason_check check (
    deleted_reason is null or deleted_reason in ('user', 'retention')),
  -- "Başarılı" yedek dosyasız olamaz.
  constraint backup_jobs_success_file_check check (
    operation <> 'backup' or status <> 'succeeded' or file_name is not null)
);

create index if not exists backup_jobs_started_idx on public.backup_jobs (started_at desc);
create index if not exists backup_jobs_success_idx
  on public.backup_jobs (operation, kind, finished_at desc) where status = 'succeeded' and deleted_at is null;
create unique index if not exists backup_jobs_file_name_idx
  on public.backup_jobs (file_name) where file_name is not null;

alter table public.backup_jobs enable row level security;

-- -----------------------------------------------------------------
-- 3. backup_audit_events (ekleme-yalnız)
-- -----------------------------------------------------------------

create table if not exists public.backup_audit_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  action text not null,
  actor text not null,
  actor_user_id uuid references auth.users (id) on delete set null,
  job_id uuid references public.backup_jobs (id) on delete set null,
  details jsonb not null default '{}'::jsonb,
  constraint backup_audit_events_actor_check check (actor in ('user', 'cron', 'system')),
  constraint backup_audit_events_action_check check (action in (
    'backup_started', 'backup_succeeded', 'backup_failed',
    'restore_started', 'restore_succeeded', 'restore_failed',
    'backup_deleted', 'retention_deleted', 'settings_updated',
    'backup_downloaded', 'stale_lock_released'))
);

create index if not exists backup_audit_events_created_idx on public.backup_audit_events (created_at desc);

alter table public.backup_audit_events enable row level security;

-- -----------------------------------------------------------------
-- 4. backup_restore_staging
-- -----------------------------------------------------------------

create table if not exists public.backup_restore_staging (
  job_id uuid not null references public.backup_jobs (id) on delete cascade,
  table_name text not null,
  ord integer not null,
  row jsonb not null,
  primary key (job_id, table_name, ord)
);

alter table public.backup_restore_staging enable row level security;

-- -----------------------------------------------------------------
-- 5. workspace_sync_state (geri yükleme epoch'u)
--    İstemci açılışta okur; yerel kopyası farklı epoch'a aitse yerel
--    önbelleği atar ve buluttan yeniden yükler. Hassas veri içermez.
-- -----------------------------------------------------------------

create table if not exists public.workspace_sync_state (
  id boolean primary key default true check (id),
  restore_epoch uuid,
  restored_at timestamptz,
  restored_from uuid
);

insert into public.workspace_sync_state (id) values (true) on conflict (id) do nothing;

alter table public.workspace_sync_state enable row level security;

drop policy if exists workspace_sync_state_read on public.workspace_sync_state;
create policy workspace_sync_state_read on public.workspace_sync_state
  for select to authenticated
  using (true);

-- -----------------------------------------------------------------
-- 6. Geri yükleme sırasında yazma koruması
--    Kilit 'restore' iken (ve kalp atışı tazeyken) geri yükleme kapsamındaki
--    tablolara yazım reddedilir; aksi halde açık bir sekmenin otomatik
--    kaydı geri yüklenen veriyle yarışabilir. Geri yükleme fonksiyonu
--    transaction'a özel bir bayrakla bu korumayı aşar.
-- -----------------------------------------------------------------

create or replace function public.backup_block_writes_during_restore()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if coalesce(current_setting('dijivo.backup_restore', true), '') = 'on' then
    return null;
  end if;
  if exists (
    select 1 from public.backup_settings s
    where s.id and s.lock_operation = 'restore' and s.lock_job_id is not null
      and s.lock_heartbeat_at > now() - interval '10 minutes'
  ) then
    raise exception 'Geri yükleme sürüyor; değişiklikler şu an kaydedilemez.' using errcode = '55006';
  end if;
  return null;
end
$$;

revoke all on function public.backup_block_writes_during_restore() from public, anon, authenticated;

do $$
declare
  t text;
begin
  foreach t in array array[
    'workspace_brands', 'workspace_projects', 'workspace_posts', 'workspace_highlights',
    'workspace_stories', 'workspace_prefs', 'calendar_items', 'share_snapshots',
    'share_feedback', 'share_feedback_workflow_events'
  ] loop
    execute format('drop trigger if exists backup_restore_write_guard on public.%I', t);
    execute format(
      'create trigger backup_restore_write_guard before insert or update or delete on public.%I '
      'for each statement execute function public.backup_block_writes_during_restore()', t);
  end loop;
end
$$;

-- -----------------------------------------------------------------
-- 7. backup_export_snapshot(): TEK ifadede tutarlı anlık görüntü
--    (tek SELECT = tek MVCC snapshot; tablolar birbiriyle tutarlı).
--    auth.users, Vault sırları ve backup_* tabloları DAHİL DEĞİLDİR.
-- -----------------------------------------------------------------

create or replace function public.backup_export_snapshot()
returns jsonb
language sql
stable
set search_path = public, pg_temp
set statement_timeout = '300s'
as $$
  select jsonb_build_object(
    'exported_at', now(),
    'tables', jsonb_build_object(
      'workspace_brands', coalesce((select jsonb_agg(to_jsonb(t) order by t.id) from public.workspace_brands t), '[]'::jsonb),
      'workspace_projects', coalesce((select jsonb_agg(to_jsonb(t) order by t.id) from public.workspace_projects t), '[]'::jsonb),
      'workspace_posts', coalesce((select jsonb_agg(to_jsonb(t) order by t.id) from public.workspace_posts t), '[]'::jsonb),
      'workspace_highlights', coalesce((select jsonb_agg(to_jsonb(t) order by t.id) from public.workspace_highlights t), '[]'::jsonb),
      'workspace_stories', coalesce((select jsonb_agg(to_jsonb(t) order by t.id) from public.workspace_stories t), '[]'::jsonb),
      'workspace_prefs', coalesce((select jsonb_agg(to_jsonb(t) order by t.user_id) from public.workspace_prefs t), '[]'::jsonb),
      'calendar_items', coalesce((select jsonb_agg(to_jsonb(t) order by t.id) from public.calendar_items t), '[]'::jsonb),
      'share_snapshots', coalesce((select jsonb_agg(to_jsonb(t) order by t.token) from public.share_snapshots t), '[]'::jsonb),
      'share_feedback', coalesce((select jsonb_agg(to_jsonb(t) order by t.created_at, t.id) from public.share_feedback t), '[]'::jsonb),
      'share_feedback_workflow_events', coalesce((select jsonb_agg(to_jsonb(t) order by t.created_at, t.id) from public.share_feedback_workflow_events t), '[]'::jsonb),
      'instagram_import_jobs', coalesce((select jsonb_agg(to_jsonb(t) order by t.created_at, t.id) from public.instagram_import_jobs t), '[]'::jsonb),
      'workspace_bootstrap', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'owner_id', t.owner_id, 'created_at', t.created_at)) from public.workspace_bootstrap t), '[]'::jsonb)
    )
  );
$$;

-- -----------------------------------------------------------------
-- 8. backup_apply_restore(): staging'deki satırlarla atomik değiştirme
--    - Yalnız kilidi tutan, çalışan 'restore' işi çağırabilir.
--    - Her tablo için beklenen satır sayısı staging ve ekleme sonrası
--      doğrulanır; uyuşmazlıkta tüm transaction geri alınır.
--    - Kolon listesi tablo kolonları ∩ yedekteki anahtarlar: yedekte olmayan
--      yeni kolonlar varsayılan değerini alır, artık olmayan kolonlar yok sayılır.
--    - instagram_import_jobs ve workspace_bootstrap'a DOKUNULMAZ.
-- -----------------------------------------------------------------

create or replace function public.backup_apply_restore(p_job_id uuid, p_expected jsonb)
returns jsonb
language plpgsql
set search_path = public, pg_temp
set statement_timeout = '300s'
as $$
declare
  v_tables constant text[] := array[
    'workspace_brands', 'workspace_projects', 'workspace_posts', 'workspace_highlights',
    'workspace_stories', 'workspace_prefs', 'calendar_items', 'share_snapshots',
    'share_feedback', 'share_feedback_workflow_events'
  ];
  v_table text;
  v_cols text;
  v_select text;
  v_count bigint;
  v_counts jsonb := '{}'::jsonb;
  v_epoch uuid := gen_random_uuid();
  v_source uuid;
  i integer;
begin
  select j.source_backup_id into v_source
    from public.backup_jobs j
   where j.id = p_job_id and j.operation = 'restore' and j.status = 'running'
   for update;
  if not found then
    raise exception 'backup_restore_job_not_running';
  end if;

  perform 1 from public.backup_settings s
   where s.id and s.lock_job_id = p_job_id and s.lock_operation = 'restore'
   for update;
  if not found then
    raise exception 'backup_restore_lock_missing';
  end if;

  foreach v_table in array v_tables loop
    if p_expected is null or jsonb_typeof(p_expected -> v_table) is distinct from 'number' then
      raise exception 'backup_restore_expected_missing:%', v_table;
    end if;
    select count(*) into v_count from public.backup_restore_staging s
     where s.job_id = p_job_id and s.table_name = v_table;
    if v_count <> (p_expected ->> v_table)::bigint then
      raise exception 'backup_restore_staging_mismatch:%', v_table;
    end if;
  end loop;

  perform set_config('dijivo.backup_restore', 'on', true);

  -- Çocuk → ebeveyn silme (where true: pg_safeupdate açıksa da çalışır).
  for i in reverse array_length(v_tables, 1) .. 1 loop
    execute format('delete from public.%I where true', v_tables[i]);
  end loop;

  -- Ebeveyn → çocuk ekleme.
  foreach v_table in array v_tables loop
    select string_agg(quote_ident(a.attname), ', ' order by a.attnum),
           string_agg('r.' || quote_ident(a.attname), ', ' order by a.attnum)
      into v_cols, v_select
      from pg_attribute a
     where a.attrelid = format('public.%I', v_table)::regclass
       and a.attnum > 0 and not a.attisdropped and a.attgenerated = ''
       and exists (
         select 1 from public.backup_restore_staging s
          where s.job_id = p_job_id and s.table_name = v_table and s.row ? a.attname::text);
    v_count := 0;
    if v_cols is not null then
      execute format(
        'insert into public.%I (%s) select %s from public.backup_restore_staging s '
        'cross join lateral jsonb_populate_record(null::public.%I, s.row) r '
        'where s.job_id = $1 and s.table_name = $2 order by s.ord',
        v_table, v_cols, v_select, v_table)
        using p_job_id, v_table;
      get diagnostics v_count = row_count;
    end if;
    if v_count <> (p_expected ->> v_table)::bigint then
      raise exception 'backup_restore_count_mismatch:%', v_table;
    end if;
    v_counts := v_counts || jsonb_build_object(v_table, v_count);
  end loop;

  delete from public.backup_restore_staging where job_id = p_job_id;

  insert into public.workspace_sync_state as w (id, restore_epoch, restored_at, restored_from)
  values (true, v_epoch, now(), v_source)
  on conflict (id) do update
    set restore_epoch = excluded.restore_epoch, restored_at = excluded.restored_at, restored_from = excluded.restored_from;

  -- Aynı transaction'da işaretlenir: yanıt ağda kaybolsa bile sunucu DB
  -- değişikliğinin işlendiğini buradan anlar.
  update public.backup_jobs
     set summary = summary || jsonb_build_object('dbCommittedAt', now(), 'epoch', v_epoch, 'restoredCounts', v_counts)
   where id = p_job_id;

  perform set_config('dijivo.backup_restore', 'off', true);
  return jsonb_build_object('counts', v_counts, 'epoch', v_epoch);
end
$$;

-- -----------------------------------------------------------------
-- 9. Yetkiler: tablolar ve fonksiyonlar yalnız service_role
-- -----------------------------------------------------------------

revoke all on table public.backup_settings, public.backup_jobs, public.backup_audit_events,
  public.backup_restore_staging from anon, authenticated;
revoke all on table public.workspace_sync_state from anon, authenticated;
grant select on table public.workspace_sync_state to authenticated;

revoke all on function public.backup_export_snapshot() from public, anon, authenticated;
revoke all on function public.backup_apply_restore(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.backup_export_snapshot() to service_role;
grant execute on function public.backup_apply_restore(uuid, jsonb) to service_role;
