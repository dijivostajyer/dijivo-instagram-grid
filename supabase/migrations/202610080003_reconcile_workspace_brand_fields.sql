-- Upgrade already-deployed 202610080002 installations without altering
-- historical migrations. These fields are required by the authenticated
-- workspace reconcile client and preserve brand-level caption helpers.

alter table public.workspace_brands
  add column if not exists hashtag_groups jsonb not null default '[]'::jsonb,
  add column if not exists default_mentions jsonb not null default '[]'::jsonb,
  add column if not exists default_ctas jsonb not null default '[]'::jsonb;

-- Keep the private workspace bucket aligned with the client-side binary
-- signed-upload limit. This is idempotent and does not affect share buckets.
update storage.buckets
set file_size_limit = 104857600
where id = 'workspace-media'
  and (file_size_limit is null or file_size_limit < 104857600);
