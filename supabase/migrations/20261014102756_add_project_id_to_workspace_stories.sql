-- Story'leri marka bazlıdan ay (project) bazlıya taşı
-- Aynı marka için farklı ayların Story'leri ayrı saklanmalı

-- project_id sütunu ekle
alter table public.workspace_stories
add column if not exists project_id text references public.workspace_projects(id) on delete cascade;

-- Yeni index oluştur (project_id + sort_order)
create index if not exists workspace_stories_project_id_idx
on public.workspace_stories(project_id, sort_order);

-- Eski brand_id null yap (geçiş dönemi için)
-- Gerçek veri migration uygulama katmanında yapılacak
-- update public.workspace_stories set project_id = null where project_id is null;
