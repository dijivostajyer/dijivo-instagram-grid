-- Reel permalink'i oynatılabilir video URL'sinden ayrı tutulur.
-- İdempotent ileri migration; mevcut persistence/RLS altyapısına dokunmaz.
alter table public.workspace_posts
  add column if not exists external_url text;
