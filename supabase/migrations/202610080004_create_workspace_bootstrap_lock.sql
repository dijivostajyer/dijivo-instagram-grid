-- Server-side singleton lock for first-account creation. RLS has no client
-- policies: only the protected service-role bootstrap endpoint can access it.
create table if not exists public.workspace_bootstrap (
  id boolean primary key default true check (id),
  owner_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.workspace_bootstrap enable row level security;
