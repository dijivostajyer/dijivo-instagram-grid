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
- **Supabase** projesi (production persistence için opsiyonel)

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

---

## Supabase Entegrasyonu

### Zorunlu Olmayan Migration'lar

Takvim bildirim/hatırlatma sisteminin kaldırılmasıyla birlikte bazı migration'lar artık gereksiz hale gelmiştir. Bunları kaldırmak için:

```bash
# Supabase SQL Editor'da çalıştırın
-- Bu migration, kullanilmayan bildirim/hatırlatma altyapisini temizler
-- supabase/migrations/202610080001_cleanup_calendar_notifications.sql
```

### Calendar Migration (Opsiyonel - Artık Kullanilmiyor)

```
supabase/migrations/202610020003_create_calendar_tables.sql
```

Bu migration **kullanilmiyor** çünkü bildirim/hatırlatma sistemi kaldırıldı. Eğer daha önce uygulanmışsa, temizlemek için yukarıdaki cleanup migration'ını kullanın.

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
