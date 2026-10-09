-- Production teslimi öncesi TEST VERİSİ temizleme yordamı.
-- Bu dosya bir reset rehberidir; şema, migration, RLS veya bucket tanımı içermez.
-- Önce yedek alın. Test Auth kullanıcısını Supabase Dashboard > Authentication >
-- Users ekranından silin; auth.users'a burada doğrudan DELETE atılmaz.

begin;

-- Uygulama verileri (çocuk tablolardan ebeveynlere).
delete from public.workspace_prefs;
delete from public.workspace_highlights;
delete from public.workspace_posts;
delete from public.workspace_projects;
delete from public.workspace_brands;

-- Takvim ve paylaşım verileri. calendar_items silinince reminder_deliveries
-- yabancı anahtarıyla otomatik temizlenir.
delete from public.calendar_items;
delete from public.push_subscriptions;
delete from public.share_snapshots;

-- Yalnız teslim öncesi ilk hesap akışını yeniden açmak için singleton lock
-- kaldırılır. Uygulama içindeki “Tüm Verileri Temizle” bu kaydı KORUR.
delete from public.workspace_bootstrap;

commit;

-- Storage UI'dan ayrıca yalnız test nesnelerini silin:
--   workspace-media/<test-user-uuid>/...
--   share-images/shares/<test-share-token>/...
--   share-media/media/<test-share-token>/...
-- Bucket'ları, RLS politikalarını, tabloları veya migration dosyalarını silmeyin.

-- Kontrol sorguları (hepsi 0 olmalıdır):
select count(*) as workspace_brands from public.workspace_brands;
select count(*) as workspace_projects from public.workspace_projects;
select count(*) as workspace_posts from public.workspace_posts;
select count(*) as calendar_items from public.calendar_items;
select count(*) as share_snapshots from public.share_snapshots;
select count(*) as workspace_bootstrap from public.workspace_bootstrap;
