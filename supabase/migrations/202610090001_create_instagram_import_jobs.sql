-- Bright Data asynchronous Instagram profile import jobs.
-- Snapshot ID remains server-side; browser only receives the local job UUID.
create table if not exists public.instagram_import_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  username text not null,
  snapshot_id text not null unique,
  status text not null default 'preparing' check (status in ('preparing', 'ready', 'failed')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  profile jsonb,
  warnings jsonb not null default '[]'::jsonb,
  error_message text,
  expires_at timestamptz not null default (now() + interval '15 minutes'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists instagram_import_jobs_user_created_idx
  on public.instagram_import_jobs (user_id, created_at desc);

alter table public.instagram_import_jobs enable row level security;

create or replace function public.dijivo_instagram_import_jobs_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists instagram_import_jobs_touch_row on public.instagram_import_jobs;
create trigger instagram_import_jobs_touch_row
  before update on public.instagram_import_jobs
  for each row execute function public.dijivo_instagram_import_jobs_touch_updated_at();
