-- Takvim / İçerik Planlama / Hatırlatma / Push modülü (Calendar fazı).
--
-- Bu dosya SUPABASE-KURULUM.md'de tarif edildiği gibi Supabase SQL
-- Editor'da **doğrudan çalıştırılır** ve tamamen idempotenttir:
-- kaç kez çalıştırılırsa çalıştırılsın aynı sonucu üretir, hata vermez.
--
-- Erişim modeli mevcut `share_snapshots` ile aynıdır:
--   - Tablolara yalnızca **service-role** (Next.js API katmanı:
--     src/app/api/calendar/*) erişir.
--   - `SUPABASE_SECRET_KEY` hiçbir zaman istemci bundle'ına girmez.
--   - Row Level Security **açık** bırakılır ve policy tanımlanmaz; bu,
--     `anon`/`authenticated` rollerinin tüm satırları görmesini engeller
--     (service_role RLS'i atlar). Supabase Auth + marka bazlı çok kiracılı
--     modele geçildiğinde buraya
--       `auth.jwt() ->> 'brand_id'` kullanan policy'ler eklenmelidir.
--
-- NOT: `brand_id` / `project_id` / `post_id` **text**'tir. Grid Planner
-- gönderi kimlikleri istemci tarafından üretilir (`mevcut-<ts>-<suffix>`)
-- ve UUID değildir; bu yüzden yabancı anahtar (FK) tanımlanmaz. Bir grid
-- gönderisi silindiğinde takvim kaydı bağlantısız kalır ve arayüz
-- "Bağlı içerik bulunamadı" fallback'ini gösterir.

-- ---------------------------------------------------------------------------
-- 0. Ortak yardımcı fonksiyonlar
-- ---------------------------------------------------------------------------

-- Yalnızca `updated_at` bakımı (push_subscriptions gibi `remind_at`
-- sütunu olmayan tablolar için).
create or replace function public.dijivo_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- `updated_at` + `remind_at` bakımı (calendar_items). Önceden var olan
-- sürüm varsa değiştirilir; yoksa oluşturulur (idempotent).
create or replace function public.dijivo_touch_calendar_row()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  if new.reminder_offset_minutes is null then
    new.remind_at := null;
  else
    new.remind_at := new.scheduled_at
      - make_interval(mins => new.reminder_offset_minutes::int);
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1. calendar_items
-- ---------------------------------------------------------------------------

create table if not exists public.calendar_items (
  id uuid primary key default gen_random_uuid(),
  brand_id text not null,
  project_id text not null,
  post_id text,
  item_type text not null check (item_type in ('post', 'reel', 'story', 'note', 'task')),
  title text not null check (char_length(trim(title)) > 0),
  description text not null default '',
  scheduled_at timestamptz not null,
  status text not null check (status in ('draft', 'planned', 'published', 'cancelled')),
  reminder_offset_minutes integer
    check (reminder_offset_minutes is null or reminder_offset_minutes >= 0),
  -- Hatırlatma zamanı trigger ile korunur (generated column yerine
  -- trigger: PG sürümünden bağımsız ve INSERT'te de çalışır).
  remind_at timestamptz,
  checklist jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Trigger'ı yeniden kurmak için önce düşürülür (yeniden çalıştırma
-- hatasını önler).
drop trigger if exists calendar_items_touch_row on public.calendar_items;
create trigger calendar_items_touch_row
  before insert or update on public.calendar_items
  for each row execute function public.dijivo_touch_calendar_row();

-- Marka izolasyonu (§23): her liste sorgusu brand_id filtresiyle gelir.
create index if not exists calendar_items_brand_id_idx
  on public.calendar_items (brand_id);
-- Aylık plan izolasyonu (§24).
create index if not exists calendar_items_project_id_idx
  on public.calendar_items (project_id);
-- Dashboard "Bugünkü Plan" / "Yaklaşanlar" aralık sorguları.
create index if not exists calendar_items_scheduled_at_idx
  on public.calendar_items (scheduled_at);
-- Arka plan hatırlatma işçisi (Edge Function) için kritik indeks:
--   where remind_at <= now() and reminder_offset_minutes is not null
create index if not exists calendar_items_remind_due_idx
  on public.calendar_items (remind_at)
  where remind_at is not null;

alter table public.calendar_items enable row level security;

-- ---------------------------------------------------------------------------
-- 2. reminder_deliveries — teslimat kaydı (once-only)
-- ---------------------------------------------------------------------------
--
-- `unique (item_id, remind_at)` bir hatırlatmanın **ikinci kez**
-- teslim edilmesini veritabanı seviyesinde imkânsız kılar. İşçi
-- `insert ... on conflict do nothing` kullanır; çakışan satır
-- "zaten gönderilmiş" demektir.
create table if not exists public.reminder_deliveries (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.calendar_items (id) on delete cascade,
  brand_id text not null,
  channel text not null check (channel in ('in_app', 'browser_push', 'email')),
  remind_at timestamptz not null,
  scheduled_at timestamptz not null,
  title text not null,
  body text not null,
  -- Teslimatın hangi hedefe gittiği (push endpoint'i vb.).
  destination text,
  created_at timestamptz not null default now(),
  delivered_at timestamptz not null default now(),
  read_at timestamptz,
  -- Kanal ayrımı YOK: aynı hatırlatma hangi kanaldan olursa olsun
  -- ikinci kez teslim edilemez (at-most-once, istemci anahtarıyla birebir aynı).
  constraint reminder_deliveries_once unique (item_id, remind_at)
);

create index if not exists reminder_deliveries_brand_id_idx
  on public.reminder_deliveries (brand_id);
-- Bildirim merkezi: okunmamıları sayma.
create index if not exists reminder_deliveries_unread_idx
  on public.reminder_deliveries (brand_id, read_at)
  where read_at is null;
create index if not exists reminder_deliveries_item_id_idx
  on public.reminder_deliveries (item_id);

alter table public.reminder_deliveries enable row level security;

-- ---------------------------------------------------------------------------
-- 3. push_subscriptions — web push abonelikleri
-- ---------------------------------------------------------------------------
--
-- `endpoint` benzersizdir: aynı tarayıcı iki kez abone olursa ikinci
-- kayıt çakışır ve güncellenir. Secret anahtarlar (`p256dh`, `auth`)
-- yalnızca bu tabloda, service-role erişimli satırlarda tutulur;
-- istemci bundle'ına **asla** girmez.
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  -- Hangi markaya bağlı abonelik (bir cihaz birden fazla marka izleyebilir).
  brand_id text not null,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists push_subscriptions_brand_id_idx
  on public.push_subscriptions (brand_id);

drop trigger if exists push_subscriptions_touch_row on public.push_subscriptions;
create trigger push_subscriptions_touch_row
  before update on public.push_subscriptions
  for each row execute function public.dijivo_touch_updated_at();

alter table public.push_subscriptions enable row level security;

-- ---------------------------------------------------------------------------
-- 4. dispatch_due_reminders() — arka plan hatırlatma işçisi RPC'si
-- ---------------------------------------------------------------------------
--
-- Edge Function (`supabase/functions/reminder-dispatch`) ham SQL göndermez;
-- PostgREST ham SQL çalıştırmaz (yalnızca JSON bekler). Bunun yerine bu
-- fonksiyon `/rest/v1/rpc/dispatch_due_reminders` üzerinden çağırılır.
--
-- Sözleşme:
--   - Vadesi gelmiş kayıtları (`remind_at <= now()`, `remind_at is not null`,
--     `status <> 'cancelled'`) tek bir `browser_push` teslimat satırına
--     çevirir.
--   - `unique (item_id, remind_at)` + `on conflict do nothing` sayesinde aynı
--     hatırlatma ASLA ikinci kez satır üretmez (at-most-once). İstemcinin
--     açıkken yazdığı `in_app` satırıyla yarış da bu kısıt tarafından
--     çözülür: ilk kazanan teslimatı sahiplenir, kaybeden çakışır ve sessizce
--     atlar — çift bildirim imkânsızdır.
--   - Yalnızca bu çağrıda YENİ oluşturulan satırları döndürür
--     (`return query insert ... returning *`) → işçi dönen satırlara push
--     gönderir; çakışan (zaten teslim edilmiş) satır dönmez, gereksiz push
--     atılmaz.
--   - `limit p_limit` (varsayılan 200) tek çağrıda işlenecek azami hatırlatma
--     sayısıdır; kalanlar bir sonraki cron çağrısında işlenir.
--
-- Yeniden çalıştırmak güvenlidir (`create or replace function`, mevcut
-- tablolara dokunmaz).

create or replace function public.dispatch_due_reminders(
  p_limit integer default 200
)
returns setof public.reminder_deliveries
language plpgsql
as $$
begin
  return query
  insert into public.reminder_deliveries
    (item_id, brand_id, channel, remind_at, scheduled_at, title, body)
  select
    i.id,
    i.brand_id,
    'browser_push',
    i.remind_at,
    i.scheduled_at,
    i.title,
    case i.item_type
      when 'task' then 'Görev hatırlatması'
      when 'note' then 'Not hatırlatması'
      when 'story' then 'Story hatırlatması'
      when 'reel' then 'Reel hatırlatması'
      else 'Post hatırlatması'
    end
  from public.calendar_items i
  where i.remind_at is not null
    and i.remind_at <= now()
    and i.status <> 'cancelled'
    and not exists (
      select 1
      from public.reminder_deliveries d
      where d.item_id = i.id
        and d.remind_at = i.remind_at
    )
  order by i.remind_at
  limit p_limit
  on conflict (item_id, remind_at) do nothing
  returning *;
end;
$$;

-- Yalnızca service-role çağırabilir (Edge Function ve Next.js API katmanı).
-- anon/authenticated/public bu işlevi çalıştıramaz.
revoke execute on function public.dispatch_due_reminders(integer)
  from public, anon, authenticated;
grant execute on function public.dispatch_due_reminders(integer)
  to service_role, postgres;

-- ---------------------------------------------------------------------------
-- 5. Doğrulama (isteğe bağlı, SQL Editor'da çalıştırılabilir)
-- ---------------------------------------------------------------------------
--
-- select table_name, indexname from pg_indexes
--  where schemaname = 'public'
--    and tablename in ('calendar_items','reminder_deliveries','push_subscriptions')
--  order by table_name, indexname;
--
-- select p.proname, pg_get_function_identity_arguments(p.oid) as args
--  from pg_proc p
--  join pg_namespace n on n.oid = p.pronamespace
--  where n.nspname = 'public' and p.proname = 'dispatch_due_reminders';
-- -- dispatch_due_reminders(integer) görünmeli (RPC'nin varlığı)
--
-- DİKKAT: `select * from public.dispatch_due_reminders(0);` doğrulama amaçlı
-- DEĞİLDİR — 0 limiti güvenlidir (satır üretmez), ancak limitsiz çağrısı
-- vadesi gelen TÜM hatırlatmaları hemen teslim eder.