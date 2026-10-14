-- Sabitlenmemiş gönderilerin (planlanan + mevcut) proje içindeki ORTAK grid
-- sırası. Kullanıcı gridde planlanan ve mevcut içerikleri karışık
-- sıralayabilir; içeriğin kaynağı (source) değişmez, yalnız sıra tutulur.
--
-- Backfill YAPILMAZ ve gerekmez: grid_order NULL olan gönderiler uygulamada
-- eski kurala göre dizilir (önce planlananlar plan_order ile, sonra mevcutlar
-- recency_index ile; bkz. src/lib/grid.ts orderNormalPosts). Böylece mevcut
-- projeler migration sonrası birebir aynı görünür. Değer, kullanıcı gridi
-- ilk kez sürükleyerek sıraladığında yazılır.
--
-- İdempotent: tekrar çalıştırılabilir.

alter table public.workspace_posts
  add column if not exists grid_order integer;

create index if not exists workspace_posts_project_grid_order_idx
  on public.workspace_posts (project_id, grid_order);
