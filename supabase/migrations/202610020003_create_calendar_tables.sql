-- Takvim / İçerik Planlama / Hatırlatma modülü (Calendar fazı).
--
-- Erişim modeli: mevcut share_snapshots ile aynı model — tablolar
-- service-role üzerinden yalnızca Next.js API katmanı
-- (src/app/api/calendar/*) tarafından okunur/yazılır; secret key
-- hiçbir zaman istemci bundle'ına gitmez. Row Level Security
-- açık bırakılır; Supabase Auth entegrasyonu geldiğinde
-- marka bazlı politikalar (auth.jwt() ->> 'brand_id') eklenir.

-- Grid'deki gönderi kimlikleri istemci tarafından üretilir
-- (`mevcut-<ts>-<suffix>` vb.) ve UUID formatında olmadığından
-- post_id text olarak kalır. Yabici anahtar kısıtı yoktur:
-- Grid Planner gönderisi silindiğinde takvim kaydı bağlantısız
-- kalabilir ve UI "Bağlı içerik bulunamadı" fallback'i gösterir.
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
  reminder_offset_minutes integer check (reminder_offset_minutes is null or reminder_offset_minutes >= 0),
  checklist jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- updated_at otomatik bakım (fresh DB'lerde de çalışması için
-- fonksiyon bu migration içinde tanımlanır).
create or replace function public.update_updated_at_column()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger calendar_items_touch_updated_at
  before update on public.calendar_items
  for each row execute function public.update_updated_at_column();

-- Marka izolasyonu (§23): her sorgu brand_id filtresiyle gelir.
create index if not exists calendar_items_brand_id_idx on public.calendar_items (brand_id);
-- Aylık plan izolasyonu (§24): proje bazlı listeleme.
create index if not exists calendar_items_project_id_idx on public.calendar_items (project_id);
-- Hatırlatma motoru tarayıcısı (Edge Function / pg_cron).
create index if not exists calendar_items_reminder_idx on public.calendar_items (scheduled_at)
  where reminder_offset_minutes is not null;

alter table public.calendar_items enable row level security;

-- Teslim edilmiş hatırlatma / bildirim merkezi kayıtları.
-- (item_id, remind_at) eşsizdir: bir hatırlatma yalnızca
-- bir kez teslim edilir (§27 once-only delivery).
create table if not exists public.reminder_deliveries (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.calendar_items (id) on delete cascade,
  brand_id text not null,
  channel text not null check (channel in ('in_app', 'browser_push', 'email')),
  remind_at timestamptz not null,
  scheduled_at timestamptz not null,
  title text not null,
  body text not null,
  created_at timestamptz not null default now(),
  delivered_at timestamptz not null default now(),
  read_at timestamptz,
  unique (item_id, remind_at)
);

create index if not exists reminder_deliveries_brand_id_idx on public.reminder_deliveries (brand_id);
create index if not exists reminder_deliveries_read_at_idx on public.reminder_deliveries (read_at);

alter table public.reminder_deliveries enable row level security;
