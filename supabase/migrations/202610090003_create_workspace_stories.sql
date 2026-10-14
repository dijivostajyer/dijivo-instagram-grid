-- Marka profiline bağlı, cihazlar arası kalıcı Story kayıtları.
create table if not exists public.workspace_stories (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text primary key,
  brand_id text not null references public.workspace_brands(id) on delete cascade,
  media_type text not null check (media_type in ('image', 'video')),
  media_path text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists workspace_stories_brand_id_idx on public.workspace_stories(brand_id, sort_order);
alter table public.workspace_stories enable row level security;
drop policy if exists workspace_stories_owner on public.workspace_stories;
create policy workspace_stories_owner on public.workspace_stories for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
