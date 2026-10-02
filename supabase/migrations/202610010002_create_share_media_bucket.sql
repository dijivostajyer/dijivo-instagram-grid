-- Phase 2 (§9): reel videoları için ayrı private bucket.
-- share-images'a ek olarak video/mp4 + video/webm kabul eder;
-- public değildir, okuma yalnızca signed URL ile olur.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'share-media',
  'share-media',
  false,
  104857600, -- 100 MB (MAX_SHARE_VIDEO_BYTES)
  array['video/mp4', 'video/webm']
)
on conflict (id) do nothing;

-- Share snapshot politikasıyla uyumlu: hizmet rolü dışı erişim yok;
-- signed URL'ler yalnızca API katmanı (service key) tarafından üretilir.
revoke all on storage.objects from anon, authenticated;
