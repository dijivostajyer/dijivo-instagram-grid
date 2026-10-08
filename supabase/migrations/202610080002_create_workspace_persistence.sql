-- Cross-device workspace persistence (brands / projects / posts / highlights / prefs)
-- ve workspace-media private bucket (görsel/video metadata yalnızca path + küçük metadata).
--
-- Bu dosya SUPABASE-KURULUM.md'de tarif edilen şekilde Supabase SQL Editor'da
-- çalıştırılır ve idempotenttir: birkaç kez çalıştırılsın aynı sonucu verir,
-- hata vermez (create table if not exists, on conflict, drop/create or replace trigger).
--
-- Erişim modeli:
--   - Tablolara yalnızca Next.js API katmanı (src/app/api/workspace/*) erişir.
--   - SUPABASE_SECRET_KEY istemci bundle'ına asla girmez.
--   - RLS açık bırakılır ve policy tanımlanmaz; bu, anon/authenticated rollerinin
--     tüm satırları görmesini engeller (service_role RLS'yi atlar).
--     Gerçek çok-kiracılı/auth stability modele geçildiğinde buraya policy'ler eklenir.

-- -----------------------------------------------------------------
-- 0. Ortak yardımcı: updated_at touch trigger
-- -----------------------------------------------------------------

create or replace function public.dijivo_workspace_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- -----------------------------------------------------------------
-- 1. workspace_brands
-- -----------------------------------------------------------------

create table if not exists public.workspace_brands (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text primary key,
  name text not null check (char_length(trim(name)) > 0),
  username text not null check (char_length(trim(username)) > 0),
  display_name text,
  profile_image_path text,         -- storage:workspace-media/<path> veya http(s)/data yoksa null
  profile_image_mime text,
  bio text,
  website text,
  phone text,
  email text,
  category text,
  post_count integer,
  followers_count integer,
  following_count integer,
  hashtag_groups jsonb not null default '[]'::jsonb,
  default_mentions jsonb not null default '[]'::jsonb,
  default_ctas jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.workspace_brands enable row level security;

-- -----------------------------------------------------------------
-- 2. workspace_projects
-- -----------------------------------------------------------------

create table if not exists public.workspace_projects (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text primary key,
  brand_id text not null references public.workspace_brands (id) on delete cascade,
  name text not null check (char_length(trim(name)) > 0),
  month integer not null check (month between 1 and 12),
  year integer not null check (year between 2000 and 2100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, brand_id, month, year)
);

create index if not exists workspace_projects_brand_id_idx
  on public.workspace_projects (brand_id);

alter table public.workspace_projects enable row level security;

-- -----------------------------------------------------------------
-- 3. workspace_posts
-- -----------------------------------------------------------------

create table if not exists public.workspace_posts (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text primary key,
  brand_id text not null references public.workspace_brands (id) on delete cascade,
  project_id text not null references public.workspace_projects (id) on delete cascade,
  source text not null check (source in ('mevcut', 'planlanan')),
  image_path text,                 -- storage:workspace-media/<path> veya storage:shares/... veya http(s)/data URL
  image_mime text,
  alt text,
  aspect_ratio text check (aspect_ratio is null or aspect_ratio in ('1:1','3:4','4:3','16:9')),
  post_type text check (post_type is null or post_type in ('post','reel','carousel')),
  caption text,

  -- Mevcut gönderi için yayın sırası; planlanan gönderi için planOrder.
  recency_index integer,
  plan_order integer,

  pinned boolean not null default false,
  pinned_order integer,

  media_type text check (media_type is null or media_type in ('image','video')),
  video_path text,                -- storage:workspace-media/<path>
  video_mime text,
  cover_path text,                -- storage:workspace-media/<path>
  cover_mime text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  check (source = 'mevcut' and recency_index is not null and plan_order is null
       or source = 'planlanan' and plan_order is not null and recency_index is null)
);

create index if not exists workspace_posts_brand_id_idx
  on public.workspace_posts (brand_id);
create index if not exists workspace_posts_project_id_idx
  on public.workspace_posts (project_id);

alter table public.workspace_posts enable row level security;

-- -----------------------------------------------------------------
-- 4. workspace_highlights
-- -----------------------------------------------------------------

create table if not exists public.workspace_highlights (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text primary key,
  brand_id text not null references public.workspace_brands (id) on delete cascade,
  title text not null check (char_length(trim(title)) > 0),
  image_path text,
  image_mime text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists workspace_highlights_brand_id_idx
  on public.workspace_highlights (brand_id);

alter table public.workspace_highlights enable row level security;

-- -----------------------------------------------------------------
-- 5. workspace_prefs
--   aktif marka / aktif proje tercihi burada saklanır.
--   Bu tercih cross-device olabilir; kullanıcı cihaz bazında farklı
--   tercih yapmak isterse UI bu tercihı gösterir ama veri kaynağı
--   bu tabloda tek olur.
-- -----------------------------------------------------------------

create table if not exists public.workspace_prefs (
  user_id uuid primary key references auth.users(id) on delete cascade,
  active_brand_id text references public.workspace_brands (id) on delete set null,
  active_project_id text references public.workspace_projects (id) on delete set null,
  updated_at timestamptz not null default now()
);

-- Tekil prefs satırı için basit touch trigger
create or replace function public.dijivo_workspace_prefs_touch()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists workspace_prefs_touch_row on public.workspace_prefs;
create trigger workspace_prefs_touch_row
  before update on public.workspace_prefs
  for each row execute function public.dijivo_workspace_prefs_touch();

alter table public.workspace_prefs enable row level security;

-- -----------------------------------------------------------------
-- 6. workspace-media bucket (görsel/video blob storage, private)
--   Mevcut share-images / share-media bucket'larına dokunmaz.
--   Burada saklanan path'ler DB'de storage:workspace-media/<path> olarak
--   saklanır; API katmanı read işlemlerinde signed URL üretir.
-- -----------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'workspace-media',
  'workspace-media',
  false,
  104857600, -- 100 MB Reel için üst sınır; yükleme binary signed URL ile yapılır.
  array['image/jpeg','image/png','image/webp','video/mp4','video/webm']
)
on conflict (id) do nothing;

revoke all on storage.objects from anon, authenticated;

-- Authenticated users can only access their own rows. `user_id` is never
-- accepted from the client as authority: policies compare it to auth.uid().
drop policy if exists workspace_brands_owner on public.workspace_brands;
create policy workspace_brands_owner on public.workspace_brands for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists workspace_projects_owner on public.workspace_projects;
create policy workspace_projects_owner on public.workspace_projects for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists workspace_posts_owner on public.workspace_posts;
create policy workspace_posts_owner on public.workspace_posts for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists workspace_highlights_owner on public.workspace_highlights;
create policy workspace_highlights_owner on public.workspace_highlights for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists workspace_prefs_owner on public.workspace_prefs;
create policy workspace_prefs_owner on public.workspace_prefs for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Private bucket: an object is accessible only when its first path segment is
-- the authenticated user's UUID. No public/anonymous policy is created.
drop policy if exists workspace_media_owner on storage.objects;
create policy workspace_media_owner on storage.objects for all to authenticated
  using (bucket_id = 'workspace-media' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'workspace-media' and (storage.foldername(name))[1] = auth.uid()::text);

-- -----------------------------------------------------------------
-- 7. updated_at trigger'ları
-- -----------------------------------------------------------------

drop trigger if exists workspace_brands_touch_row on public.workspace_brands;
create trigger workspace_brands_touch_row
  before update on public.workspace_brands
  for each row execute function public.dijivo_workspace_touch_updated_at();

drop trigger if exists workspace_projects_touch_row on public.workspace_projects;
create trigger workspace_projects_touch_row
  before update on public.workspace_projects
  for each row execute function public.dijivo_workspace_touch_updated_at();

drop trigger if exists workspace_posts_touch_row on public.workspace_posts;
create trigger workspace_posts_touch_row
  before update on public.workspace_posts
  for each row execute function public.dijivo_workspace_touch_updated_at();

drop trigger if exists workspace_highlights_touch_row on public.workspace_highlights;
create trigger workspace_highlights_touch_row
  before update on public.workspace_highlights
  for each row execute function public.dijivo_workspace_touch_updated_at();

-- -----------------------------------------------------------------
-- 8. Doğrulama (isteğe bağlı)
-- -----------------------------------------------------------------

-- select table_name from information_schema.tables
--   where table_schema = 'public'
--   and table_name in ('workspace_brands','workspace_projects','workspace_posts','workspace_highlights','workspace_prefs');
-- select name from storage.buckets where name in ('share-images','share-media','workspace-media');
