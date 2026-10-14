-- workspace_stories.project_id için GÜVENLİ ve idempotent backfill.
--
-- 20261014102756 migration'ı project_id sütununu (NULL olabilir) ekledi.
-- Ondan önce yazılmış Story kayıtları marka bazlıydı ve project_id'si NULL.
--
-- Kural:
--   * Markanın workspace_projects tablosunda TAM OLARAK 1 projesi varsa,
--     Story'nin ait olabileceği tek ay odur → project_id o projeye atanır.
--   * Markanın birden fazla projesi varsa hangi aya ait olduğu bilinemez →
--     kayıt NULL bırakılır. Tahmin (ör. en son güncellenen ay) YAPILMAZ.
--   * Ek güvence: atanan proje Story ile aynı kullanıcıya ait olmalı.
--
-- İdempotent: yalnız project_id IS NULL satırlara dokunur; tekrar çalışınca
-- değişiklik yapmaz. NOT NULL kısıtı eklenmez, çünkü belirsiz eski kayıtlar
-- kalabilir. Uygulama NULL project_id'li Story'leri hiçbir ayda göstermez
-- ve yeni Story'leri her zaman project_id ile yazar.

with brand_project_counts as (
  select brand_id, count(*) as project_count, min(id) as only_project_id
  from public.workspace_projects
  group by brand_id
)
update public.workspace_stories as story
set project_id = counts.only_project_id,
    updated_at = now()
from brand_project_counts as counts
join public.workspace_projects as project on project.id = counts.only_project_id
where story.project_id is null
  and counts.project_count = 1
  and story.brand_id = counts.brand_id
  and project.user_id = story.user_id;

-- Uygulama sonrası belirsiz kalan kayıtları görmek için (salt okunur):
-- select story.id, story.user_id, story.brand_id, story.created_at,
--        (select count(*) from public.workspace_projects p where p.brand_id = story.brand_id) as project_count
-- from public.workspace_stories story
-- where story.project_id is null
-- order by story.brand_id, story.created_at;
