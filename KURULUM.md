# Dijivo Kurulum Rehberi

Bu dosya, Dijivo Instagram Grid Preview Tool projesini yerel ve production ortamlarında kurulum ve çalışması için gereken adımları içerir.

## İçindekiler

1. [Proje Hakkında](#proje-hakkinda)
2. [Ön Gereksinimler](#on-gereksinimler)
3. [Yerel Geliştirme Kurulumu](#yerel-gelistirme-kurulumu)
4. [Çevre Değişkenleri](#cevre-degiskenleri)
5. [Supabase Entegrasyonu](#supabase-entegrasyonu)
6. [Migration Olarak Çıkmak Istenedigini Unutmayin](#migration-olarak-cikmak-isteneyni-unutmayin)
7. [Test ve Doğrulama](#test-ve-dogrulama)
8. [Production Deployment](#production-deployment)

---

## Proje Hakkında

Dijivo, Instagram profil grid görünümünü planlamanızı ve A4 PDF/JPG olarak dışa aktarmanızı sağlayan bir araçtır. Mevcut ve planlanan içerikleri tek bir 3 sütunlu gridde göstererek, müşterilere göndermeden önce içeriklerin kapaklarını kontrol etmenizi sağlar.

**Kapsam:**
- Ay/Hafta/Gün takvim görünümleri ile içerik planlama
- Post/Reel/Story/Not/Görev türleri
- Sürükle-bırak ile sıralama, düzenleme, silme
- Checklist yönetimi
- Grid Planner bağlantısı
- Dashboard: Bugünkü Plan, Yaklaşanlar
- Marka/projesi izolasyonu
- Supabase calendar persistence

**Kapsam Dışı (Kaldırılmıştır):**
- Bildirim sistemi ve hatırlatmalar
- Push notification altyapısı
- Reminder dispatch mekanizmaları
- Tüm notification/reminder türleri ve UI bileşenleri

---

## Ön Gereksinimler

- **Node.js** >= 18.x
- **npm** >= 9.x
- **Git** >= 2.x
- **Supabase** projesi (production persistence için opsiyonel — takvim kalıcılığı için ihtiyaç duyulabilir; yoksa localStorage fallback ile çalışır)

---

## Yerel Geliştirme Kurulumu

```bash
# 1. Depoyu klonlayın
git clone https://github.com/<kullanici>/dijivo-instagram-grid.git
cd dijivo-instagram-grid

# 2. Bağımlılıkları yükleyin
npm install

# 3. Geliştirme sunucusunu başlatın
npm run dev
```

Uygulama `http://localhost:3000` adresinde çalışır.

---

## Çevre Değişkenleri

`.env.example` dosyası şablonu içerir:

```env
# Supabase (opsiyonel - yoksa local fallback kullanılır)
SUPABASE_URL=
SUPABASE_SECRET_KEY=
```

**Not:** Supabase yapılandırılmamışsa, tüm takvim verileri localStorage fallback ile çalışır. Production için Supabase yapılandırması önerilir.

### Workspace giriş ve cross-device kalıcılığı

Grid workspace’i Supabase Auth ile korunur. `.env.local` ve deployment ortamına şunları ekleyin:

```env
NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<Supabase Publishable/anon key>
SUPABASE_WORKSPACE_MEDIA_BUCKET=workspace-media
```

`SUPABASE_SECRET_KEY` veya `service_role` anahtarını `NEXT_PUBLIC_` ile başlayan bir değişkene koymayın. Workspace CRUD ve Storage erişimi, tarayıcıdaki Auth oturumu ile RLS üzerinden yapılır.
`NEXT_PUBLIC_SUPABASE_ANON_KEY` adı Supabase'in public/anon API anahtarının teknik adıdır; **anonymous sign-in değildir**. Bu uygulama yalnız email + password ile `signUp` ve `signInWithPassword` çağrıları yapar.

1. Supabase Dashboard → Authentication → Providers bölümünde **Email** sağlayıcısını etkinleştirin.
2. Yeni kurulumda `supabase/migrations/202610080002_create_workspace_persistence.sql` migration'ını SQL Editor’da çalıştırın. Daha önce bu migration uygulanmışsa ayrıca `202610080003_reconcile_workspace_brand_fields.sql` migration'ını çalıştırın. Bunlar workspace tablolarını, `user_id` ilişkisini, RLS politikalarını, brand hashtag alanlarını ve private `workspace-media` bucket’ını oluşturur/günceller.
3. Uygulamayı açın ve giriş ekranındaki **İlk hesabı oluştur** ile e-posta/şifre hesabını oluşturun. E-posta onayı etkinse gelen bağlantıyı tamamlayın.
4. Girişten sonra mevcut localStorage/IndexedDB grid verisi yalnızca kullanıcının uzak workspace’i boşsa aynı kullanıcıya aktarılır. Yerel kopya silinmez; aktarımdan sonra sync başarısız olsa da fallback olarak kalır.

Medya nesneleri `<auth.uid()>/<brandId>/<...>` mantığında private bucket’a yazılır. Image/video için kısa ömürlü signed URL kullanılır; 100 MB Reel yüklemeleri JSON/base64 yerine doğrudan signed binary upload ile aktarılır.

---

## Supabase Entegrasyonu

### Temizlik Migrationı

Takvim bildirim/hatırlatma sistemi kaldırıldı. Hazır migration listesinde **kullanılmayan infrastructure kalan bir yığın hala bulunur** (reminder dispatch cron jobı, eski VAPID ikon setleri, deprecated yükler). Bunları üretim çevresinde temizlemek için yalnızca **`202610080001_cleanup_calendar_notifications.sql`** kullanılır.

```sql
-- Supabase SQL Editor'da (veya 전담 배포 스크립트 – db parolası olan makinelerden)
-- Bu migration, kullanılmayan bildirim/hatırlatma altyapisini temizler:
--   supabase/migrations/202610080001_cleanup_calendar_notifications.sql
```

### Takvim Migrationı

```
supabase/migrations/202610020003_create_calendar_tables.sql
```

Bu migration **kullanılıyor**. Bildirim/hatırlatma sistemi kaldırılmış olsa da, **takvim kalıcılığı (calendar_items)** ve **takvim API** (`/api/calendar/*`) hâlâ bu tablolar tarafından beslenir. Bu dosya kullanılmıyor değil; kaldırılmamıştır — aktif planlama verisini yok etmez.

Takvim verisi iki katmanda saklanabilir:
- Supabase yapılandırılmış ve migration uygulanmamışsa → `/api/calendar/config` `{supabase:false}` döner ve istemci **localStorage fallback** kullanır.

---

## Test ve Doğrulama

```bash
# Tüm testleri çalıştırın
npm test

# Tip kontrolü
npx tsc --noEmit

# Production build
npm run build
```

Bütün yukaridaki komutlar **başarılı** olmalıdır:

- `npm test`: 292/292 test PASS
- `npx tsc --noEmit`: 0 hata
- `npm run build`: başarılı

---

## Production Deployment

### Önerilen Yöntem: Vercel

```bash
# Vercel'e deploy etmek için
vercel --prod
```

Vercel'enSupabase bağlantısı için ortam değişkenlerini ayarlayın:

1. Vercel Dashboard → Project Settings → Environment Variables
2. `SUPABASE_URL` ve `SUPABASE_SECRET_KEY` ekleyin

### Static Export (Alternatif)

```bash
# Static site olarak build etme (SSR gerektirmez)
npm run build
# .next/standalone veya out/ klasörünü deploy edin
```

---

## Bilinen Sorunlar ve Riskler

1. **Supabase migration erişimi:** Bu ortamdan Supabase migration'ları çalıştırılamaz (DB parolası yok). Production deployment öncesi Supabase SQL Editor kullanın.

2. **Bildirim sistemi kaldırıldı:** Artık herhangi bir hatırlatma veya push bildirimi gönderilmez. Saf planlama sistemi kullanılmaktadır.

3. **Çoklu marka Blob referansları:** Aylık plan kopyasında görsel Blob referansları ortak kullanılır. Aktif proje silinmediği sürece güvenlidir.

4. **Revoke endpoint'ı:** Capability-token modelindedir (auth/owner yok). Bu bilinen sınırlamadır.

5. **Çok sayfalı JPG:** ~10+ sayfada tarayıcı tuval sınırı sorunu çıkabilir.

---

## Dosya Yapısı

```
/
├── src/
│   ├── app/                    # Next.js App Router sayfaları
│   │   ├── api/               # API route'ları
│   │   │   └── calendar/      # Calendar API (items, brand-items, config)
│   │   ├── share/            # Share sayfaları
│   │   └── page.tsx          # Ana sayfa
│   ├── components/
│   │   ├── calendar/         # Takvim bileşenleri (Ay/Hafta/Gün)
│   │   ├── BrandEditor.tsx, BrandHub.tsx, DashboardOverview.tsx
│   │   ├── GridManager.tsx   # Ana uygulama kontrolleri
│   │   └── ...
│   ├── lib/                  # Saf fonksiyonlar ve depolama
│   │   ├── calendar-types.ts # Takvim veri tipleri
│   │   ├── calendar-utils.ts # Takvim yardımcı fonksiyonlar
│   │   ├── calendar-store.ts # Depolama soyutlaması
│   │   ├── supabase-calendar-store.ts
│   │   ├── api-calendar-store.ts
│   │   └── ...
│   └── hooks/
│       ├── use-calendar-store.ts  # Takvim hook'u
│       └── use-persisted-grid.ts  # Kalıcılık hook'u
├── supabase/
│   └── migrations/           # Supabase migration dosyaları
└── package.json
```

---

## İletişim ve Destek

- Proje: [GitHub Repository](https://github.com/dijivostajyer/dijivo-instagram-grid)
- Sorun Bildir: GitHub Issues üzerinden

---

*Bu dosya AI tarafından oluşturulmuştur ve manuel olarak düzenlenmelidir.*
