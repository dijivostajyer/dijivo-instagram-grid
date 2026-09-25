# Supabase share storage kurulumu

1. Supabase projesi oluşturun ve SQL Editor'de `supabase/migrations/202609250001_create_share_snapshots.sql` dosyasını çalıştırın.
2. Storage'da `share-images` bucket'ının private olduğunu doğrulayın.
3. `.env.example` dosyasını `.env.local` olarak kopyalayın; `SUPABASE_URL` ve yalnızca server için `SUPABASE_SECRET_KEY` değerlerini girin.
4. Varsayılan bucket `share-images`tir. `SUPABASE_SHARE_BUCKET` ile özel ad kullanırsanız migration bu bucket'ı otomatik oluşturmaz; private, JPEG/PNG/WebP ve 10 MB ayarlarıyla ayrıca oluşturun. Paylaşım ömrü için `SHARE_TTL_DAYS=30` kullanın.
5. Development sunucusunu yeniden başlatın, gridden link oluşturun ve `/share/<token>` adresini farklı tarayıcıda açın.

Secret key'i `NEXT_PUBLIC_` değişkenine koymayın, client code'a aktarmayın veya commit etmeyin. Production'da Supabase ayarları eksikse share route kontrollü hata verir; memory fallback kullanılmaz.
