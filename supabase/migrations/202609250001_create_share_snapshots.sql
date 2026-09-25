create table if not exists public.share_snapshots (
  token uuid primary key,
  version integer not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  payload jsonb not null
);

create index if not exists share_snapshots_expires_at_idx on public.share_snapshots (expires_at);
create index if not exists share_snapshots_revoked_at_idx on public.share_snapshots (revoked_at);
alter table public.share_snapshots enable row level security;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('share-images', 'share-images', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = 10485760,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];
