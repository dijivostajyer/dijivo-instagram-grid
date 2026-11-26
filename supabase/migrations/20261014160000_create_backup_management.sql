-- Yedekleme + Geri Yükleme Merkezi (Faz 6) — v4.
--
-- YEDEK KAPSAMI (SQL tarafı)
--   Dışa aktarılır VE geri yüklenir (10 tablo):
--     workspace_brands, workspace_projects, workspace_posts, workspace_highlights,
--     workspace_stories, workspace_prefs, calendar_items, share_snapshots,
--     share_feedback, share_feedback_workflow_events
--   Dışa aktarılır AMA geri YÜKLENMEZ (restore dokunmaz):
--     instagram_import_jobs (geçici; snapshot_id içerir), workspace_bootstrap (sahiplik kilidi)
--   KAPSAM DIŞI: auth.users/parolalar, Vault, Storage nesneleri ve storage.objects meta verisi
--     (medya uygulama motoru tarafından ayrıca, DB snapshot'ından FARKLI anda paketlenir),
--     RLS/policy/şema, backup_* tabloları, pg_cron/uzantılar.
--
-- Yedek paketleri (ZIP) Supabase'de DEĞİL, sunucu dosya sisteminde tutulur.
-- backup_* tablolarına yalnız service_role erişir (RLS açık, policy yok), en az ayrıcalıkla:
--   backup_settings: SELECT, INSERT, UPDATE | backup_jobs: SELECT, INSERT, UPDATE, DELETE
--   backup_audit_events: INSERT | backup_restore_staging: INSERT, DELETE + SELECT(job_id)
--   workspace_sync_state: service_role'e tablo yetkisi YOK; authenticated yalnız
--   id, restore_epoch, restored_at kolonlarında SELECT.
-- SECURITY DEFINER fonksiyonlar search_path = pg_catalog, pg_temp ile çalışır; tüm nesne
-- referansları şema ile niteliklidir. EXECUTE: export/apply yalnız service_role; diğer
-- yardımcı fonksiyonlar yalnız sahip. Storage izinlerine DOKUNULMAZ.
--
-- İdempotent. Production'a uygulanması ayrı karardır.

-- -----------------------------------------------------------------
-- 0. Ön kontrol (preflight): yetersizse HİÇBİR şey oluşmadan durur
-- -----------------------------------------------------------------

do $$
declare
  v_role pg_roles%rowtype;
  t text;
begin
  select * into v_role from pg_roles where rolname = current_user;

  foreach t in array array[
    'workspace_brands', 'workspace_projects', 'workspace_posts', 'workspace_highlights',
    'workspace_stories', 'workspace_prefs', 'calendar_items', 'share_snapshots',
    'share_feedback', 'share_feedback_workflow_events'
  ] loop
    if to_regclass('public.' || t) is null then
      raise exception 'migration16_preflight: tablo yok: %', t;
    end if;
    if not (has_table_privilege(current_user, 'public.' || t, 'SELECT')
        and has_table_privilege(current_user, 'public.' || t, 'INSERT')
        and has_table_privilege(current_user, 'public.' || t, 'UPDATE')
        and has_table_privilege(current_user, 'public.' || t, 'DELETE')) then
      raise exception 'migration16_preflight: % rolünün public.% üzerinde SELECT/INSERT/UPDATE/DELETE yetkisi yok', current_user, t;
    end if;
    if not (v_role.rolsuper or v_role.rolbypassrls) and exists (
      select 1 from pg_class c
       where c.oid = to_regclass('public.' || t)
         and (c.relowner <> v_role.oid or c.relforcerowsecurity)) then
      raise exception 'migration16_preflight: % rolü public.% üzerinde RLS''yi atlayamaz', current_user, t;
    end if;
  end loop;

  foreach t in array array['instagram_import_jobs', 'workspace_bootstrap'] loop
    if to_regclass('public.' || t) is null then
      raise exception 'migration16_preflight: tablo yok: %', t;
    end if;
    if not has_table_privilege(current_user, 'public.' || t, 'SELECT') then
      raise exception 'migration16_preflight: % rolünün public.% üzerinde SELECT yetkisi yok', current_user, t;
    end if;
    if not (v_role.rolsuper or v_role.rolbypassrls) and exists (
      select 1 from pg_class c
       where c.oid = to_regclass('public.' || t)
         and (c.relowner <> v_role.oid or c.relforcerowsecurity)) then
      raise exception 'migration16_preflight: % rolü public.% üzerinde RLS''yi atlayamaz', current_user, t;
    end if;
  end loop;
end
$$;

-- -----------------------------------------------------------------
-- 1. backup_settings (tekil satır + kilit)
-- -----------------------------------------------------------------

create table if not exists public.backup_settings (
  id boolean primary key default true check (id),
  auto_enabled boolean not null default true,
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
  constraint backup_jobs_file_name_check check (
    file_name is null or file_name ~ '^backup-[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9]{6}-[0-9a-f]{8}\.zip$'),
  constraint backup_jobs_deleted_reason_check check (
    deleted_reason is null or deleted_reason in ('user', 'retention')),
  constraint backup_jobs_success_file_check check (
    operation <> 'backup' or status <> 'succeeded' or file_name is not null)
);

create index if not exists backup_jobs_started_idx on public.backup_jobs (started_at desc);
create index if not exists backup_jobs_success_idx
  on public.backup_jobs (operation, kind, finished_at desc) where status = 'succeeded' and deleted_at is null;
create unique index if not exists backup_jobs_file_name_idx
  on public.backup_jobs (file_name) where file_name is not null;

alter table public.backup_jobs enable row level security;

-- Devam eden restore işi, kilit sahibi restore işi ve çalışan bir restore'un
-- kaynak/güvenlik yedeği silinemez. discardJob (operation='backup') etkilenmez.
create or replace function public.backup_protect_running_restore()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  if (old.operation = 'restore' and old.status = 'running')
     or exists (
       select 1 from public.backup_settings s
       where s.id and s.lock_operation = 'restore' and s.lock_job_id = old.id)
     or exists (
       select 1 from public.backup_jobs r
       where r.operation = 'restore' and r.status = 'running'
         and (r.source_backup_id = old.id or r.safety_backup_id = old.id))
  then
    raise exception 'backup_job_in_use' using errcode = '55006';
  end if;
  return old;
end
$$;

revoke all on function public.backup_protect_running_restore() from public, anon, authenticated, service_role;

drop trigger if exists backup_jobs_protect_running_restore on public.backup_jobs;
create trigger backup_jobs_protect_running_restore
  before delete on public.backup_jobs
  for each row execute function public.backup_protect_running_restore();

-- -----------------------------------------------------------------
-- 3. backup_audit_events (ekleme-yalnız; trigger ile zorlanır)
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

-- UPDATE yalnız FK "ON DELETE SET NULL" sonucu job_id / actor_user_id'nin NULL'a
-- çekilmesine izin verir (ikisi birlikte veya ayrı); başka her UPDATE, DELETE ve
-- TRUNCATE reddedilir. Tablo sahibi/superuser trigger'ı devre dışı bırakabilir:
-- kasıtlı kurcalamaya karşı mutlak koruma değildir. Tablo erişimi yapmaz: INVOKER.
create or replace function public.backup_audit_events_append_only()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  if tg_op = 'UPDATE' then
    if new.id = old.id
       and new.created_at = old.created_at
       and new.action = old.action
       and new.actor = old.actor
       and new.details = old.details
       and (new.job_id is not distinct from old.job_id or (new.job_id is null and old.job_id is not null))
       and (new.actor_user_id is not distinct from old.actor_user_id
            or (new.actor_user_id is null and old.actor_user_id is not null))
    then
      return new;
    end if;
  end if;
  raise exception 'backup_audit_events_append_only' using errcode = '42501';
end
$$;

revoke all on function public.backup_audit_events_append_only() from public, anon, authenticated, service_role;

drop trigger if exists backup_audit_events_row_guard on public.backup_audit_events;
create trigger backup_audit_events_row_guard
  before update or delete on public.backup_audit_events
  for each row execute function public.backup_audit_events_append_only();

drop trigger if exists backup_audit_events_truncate_guard on public.backup_audit_events;
create trigger backup_audit_events_truncate_guard
  before truncate on public.backup_audit_events
  for each statement execute function public.backup_audit_events_append_only();

-- -----------------------------------------------------------------
-- 4. backup_restore_staging
-- -----------------------------------------------------------------

create table if not exists public.backup_restore_staging (
  job_id uuid not null references public.backup_jobs (id) on delete cascade,
  table_name text not null,
  ord integer not null,
  "row" jsonb not null,
  primary key (job_id, table_name, ord)
);

alter table public.backup_restore_staging enable row level security;

-- -----------------------------------------------------------------
-- 5. workspace_sync_state (geri yükleme epoch'u)
--    İstemci yalnız restore_epoch'u okur; restored_from (iç iş kimliği) gizlidir.
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
--    Bypass = transaction'a özel bayrak == kilidi tutan restore işinin UUID'si.
-- -----------------------------------------------------------------

create or replace function public.backup_restore_bypass_active()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
  select exists (
    select 1 from public.backup_settings s
    where s.id and s.lock_operation = 'restore' and s.lock_job_id is not null
      and s.lock_job_id::text = coalesce(pg_catalog.current_setting('dijivo.backup_restore', true), ''));
$$;

revoke all on function public.backup_restore_bypass_active() from public, anon, authenticated, service_role;

create or replace function public.backup_block_writes_during_restore()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  if public.backup_restore_bypass_active() then
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

revoke all on function public.backup_block_writes_during_restore() from public, anon, authenticated, service_role;

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
      'create trigger backup_restore_write_guard before insert or update or delete or truncate on public.%I '
      'for each statement execute function public.backup_block_writes_during_restore()', t);
  end loop;
end
$$;

-- -----------------------------------------------------------------
-- 7. backup_export_snapshot(): TEK ifadede tutarlı anlık görüntü (SECURITY DEFINER)
-- -----------------------------------------------------------------

create or replace function public.backup_export_snapshot()
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, pg_temp
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
-- 8. backup_apply_restore(): staging'deki satırlarla atomik değiştirme (SECURITY DEFINER)
--    Kilit sırası: iş satırı → ayar satırı (FOR UPDATE) → 10 tabloya SHARE ROW EXCLUSIVE.
--    Silme çocuk → ebeveyn, ekleme ebeveyn → çocuk; FK/CHECK/sayı hatası = tam geri alma.
-- -----------------------------------------------------------------

create or replace function public.backup_apply_restore(p_job_id uuid, p_expected jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
set statement_timeout = '300s'
set lock_timeout = '30s'
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
  v_heartbeat timestamptz;
  i integer;
begin
  select j.source_backup_id into v_source
    from public.backup_jobs j
   where j.id = p_job_id and j.operation = 'restore' and j.status = 'running'
   for update;
  if not found then
    raise exception 'backup_restore_job_not_running';
  end if;

  select s.lock_heartbeat_at into v_heartbeat
    from public.backup_settings s
   where s.id and s.lock_job_id = p_job_id and s.lock_operation = 'restore'
   for update;
  if not found then
    raise exception 'backup_restore_lock_missing';
  end if;
  if v_heartbeat is null or v_heartbeat <= now() - interval '10 minutes' then
    raise exception 'backup_restore_lock_stale';
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

  perform set_config('dijivo.backup_restore', p_job_id::text, true);

  lock table public.workspace_brands, public.workspace_projects, public.workspace_posts,
    public.workspace_highlights, public.workspace_stories, public.workspace_prefs,
    public.calendar_items, public.share_snapshots, public.share_feedback,
    public.share_feedback_workflow_events
    in share row exclusive mode;

  for i in reverse array_length(v_tables, 1) .. 1 loop
    execute format('delete from public.%I where true', v_tables[i]);
  end loop;

  foreach v_table in array v_tables loop
    select string_agg(quote_ident(a.attname), ', ' order by a.attnum),
           string_agg('r.' || quote_ident(a.attname), ', ' order by a.attnum)
      into v_cols, v_select
      from pg_attribute a
     where a.attrelid = format('public.%I', v_table)::regclass
       and a.attnum > 0 and not a.attisdropped and a.attgenerated = ''
       and exists (
         select 1 from public.backup_restore_staging s
          where s.job_id = p_job_id and s.table_name = v_table and jsonb_exists(s."row", a.attname::text));
    v_count := 0;
    if v_cols is not null then
      execute format(
        'insert into public.%I (%s) select %s from public.backup_restore_staging s '
        'cross join lateral pg_catalog.jsonb_populate_record(null::public.%I, s."row") r '
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

  update public.backup_jobs
     set summary = summary || jsonb_build_object('dbCommittedAt', now(), 'epoch', v_epoch, 'restoredCounts', v_counts)
   where id = p_job_id;

  perform set_config('dijivo.backup_restore', '', true);
  return jsonb_build_object('counts', v_counts, 'epoch', v_epoch);
end
$$;

-- -----------------------------------------------------------------
-- 9. ACL sıfırlama (YALNIZ bu migration'ın 5 tablosu ve 6 fonksiyonu; storage'a DOKUNULMAZ)
--    Varsayılan ACL'den gelen ek yetkiler (service_role dahil) önce temizlenir,
--    sonra yalnız gerekenler verilir.
-- -----------------------------------------------------------------

revoke all on table public.backup_settings, public.backup_jobs, public.backup_audit_events,
  public.backup_restore_staging, public.workspace_sync_state
  from public, anon, authenticated, service_role;

revoke all on function public.backup_export_snapshot() from public, anon, authenticated, service_role;
revoke all on function public.backup_apply_restore(uuid, jsonb) from public, anon, authenticated, service_role;

-- Statik REVOKE'ların görmediği diğer alıcılar (ör. varsayılan ACL ile gelenler).
do $$
declare
  r record;
begin
  for r in
    select c.oid::regclass::text as rel, a.grantee
      from pg_class c
      cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
     where c.relnamespace = 'public'::regnamespace
       and c.relname in ('backup_settings', 'backup_jobs', 'backup_audit_events',
                         'backup_restore_staging', 'workspace_sync_state')
       and a.grantee <> c.relowner
     group by 1, 2
  loop
    execute format('revoke all on table %s from %s', r.rel,
      case when r.grantee = 0 then 'public' else quote_ident(pg_get_userbyid(r.grantee)) end);
  end loop;

  for r in
    select p.oid::regprocedure::text as sig, a.grantee
      from pg_proc p
      cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
     where p.pronamespace = 'public'::regnamespace
       and p.proname in ('backup_export_snapshot', 'backup_apply_restore', 'backup_restore_bypass_active',
                         'backup_block_writes_during_restore', 'backup_protect_running_restore',
                         'backup_audit_events_append_only')
       and a.privilege_type = 'EXECUTE'
       and a.grantee <> p.proowner
     group by 1, 2
  loop
    execute format('revoke all on function %s from %s', r.sig,
      case when r.grantee = 0 then 'public' else quote_ident(pg_get_userbyid(r.grantee)) end);
  end loop;
end
$$;

-- -----------------------------------------------------------------
-- 10. Yetkiler (en az ayrıcalık; uygulama akışlarına göre, bkz. src/lib/backup/supabase.ts)
-- -----------------------------------------------------------------

grant select, insert, update on table public.backup_settings to service_role;
grant select, insert, update, delete on table public.backup_jobs to service_role;
grant insert on table public.backup_audit_events to service_role;
-- clearStaging: DELETE ... WHERE job_id = $1 → job_id kolonunda SELECT gerekir.
grant insert, delete on table public.backup_restore_staging to service_role;
grant select (job_id) on table public.backup_restore_staging to service_role;

-- workspace_sync_state: service_role'e tablo yetkisi YOK (yazma yalnız DEFINER fonksiyonla).
grant select (id, restore_epoch, restored_at) on table public.workspace_sync_state to authenticated;

grant execute on function public.backup_export_snapshot() to service_role;
grant execute on function public.backup_apply_restore(uuid, jsonb) to service_role;
