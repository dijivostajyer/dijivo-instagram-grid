# Supabase Kurulumu — Takvim / Hatırlatma / Push

Bu dosya, takvim modülünün **production persistence** ve **arka plan
bildirim** altyapısını ayağa kaldırmak için gereken adımları içerir.

> **Önemli:** Migration bu çalışma ortamından **uygulanamaz** (veritabanı
> parolası yok, service-role anahtarı DDL yetkisine sahip değil). Bu
> nedenle uygulama, tablolar yoksa sessizce localStorage'a düşer
> (`/api/calendar/config` → `{"supabase":false}`). Production'da
> aşağıdaki adımlar **zorunludur**.

---

## 1. Takvim tabloları (zorunlu)

Supabase Dashboard → **SQL Editor** → aşağıdaki dosyanın **tamamını**
çalıştırın:

```
supabase/migrations/202610020003_create_calendar_tables.sql
```

Oluşturulan nesneler:

| Tablo | Amaç |
| --- | --- |
| `calendar_items` | Takvim kayıtları (Post/Reel/Story/Not/Görev) |
| `reminder_deliveries` | Teslimat kayıtları; `unique (item_id, remind_at)` ile **at-most-once** |
| `push_subscriptions` | Web push abonelikleri (`endpoint` benzersiz) |

Dosya **idempotenttir** (kaç kez çalıştırılırsa çalıştırılsın aynı
sonucu verir) ve şunları içerir:

- `dijivo_touch_calendar_row()` / `dijivo_touch_updated_at()` trigger
  fonksiyonları — `updated_at` + `remind_at` bakımı,
- `calendar_items_remind_due_idx` — arka plan işçisinin kritik indeksi,
- RLS **açık**, policy **tanımsız** → yalnızca `service_role` erişir.

### Doğrulama

```sql
select table_name
from information_schema.tables
where schemaname = 'public'
  and table_name in ('calendar_items','reminder_deliveries','push_subscriptions')
order by table_name;
-- 3 satır dönmeli

select indexname from pg_indexes
where schemaname = 'public' and tablename = 'calendar_items'
order by indexname;
-- calendar_items_remind_due_idx görünmeli
```

Uygulama tarafında doğrulama:

```bash
curl -s http://localhost:3000/api/calendar/config
# {"supabase":true}   ← migration uygulandıktan SONRA
```

`{"supabase":false}` dönüyorsa migration henüz uygulanmamıştır ya da
`SUPABASE_URL` / `SUPABASE_SECRET_KEY` eksiktir.

---

## 2. Arka plan hatırlatma işçisi

Tarayıcıdaki 15 saniyelik polling yalnızca **sekme açıkken** çalışır.
Gerçek arka plan teslimatı Edge Function ile yapılır.

### 2.1 Edge Function'ı deploy et

```bash
supabase functions deploy reminder-dispatch
```

### 2.2 VAPID anahtarları

```bash
npx web-push generate-vapid-keys
```

**Private** anahtarı Edge Function secret'ı olarak verin:

```bash
supabase secrets set \
  VAPID_PUBLIC_KEY=<public> \
  VAPID_PRIVATE_KEY=<private>
```

Güvenlik kuralları:

- `VAPID_PRIVATE_KEY` **asla** `NEXT_PUBLIC_` önekiyle tanımlanmaz,
- `.env.local`/`.env` dosyasına yazılmaz ve commit edilmez,
- istemci kodu yalnızca `NEXT_PUBLIC_VAPID_PUBLIC_KEY` görür
  (public anahtar gizli değildir; abonelik açmak için gerekir).

### 2.3 Cron zamanlaması

`supabase/migrations/202610020003_create_calendar_tables.sql`
çalıştırıldıktan **sonra**, SQL Editor'da:

```
supabase/migrations/202610020004_schedule_reminder_dispatch.sql
```

Bu, `reminder-dispatch` işini `pg_cron` ile **her dakika** tetikler.

### 2.4 Elle doğrulama

```bash
curl -X POST \
  -H "Authorization: Bearer <service_role_key>" \
  -H "Content-Type: application/json" \
  https://<project-ref>.supabase.co/functions/v1/reminder-dispatch
```

Beklenen: `{"ok":true,"created":0,...}`.
Aynı komutu ikinci kez çalıştırdığınızda yine `created:0` olmalıdır —
**idempotency kanıtı**.

### 2.5 Uygulama tarafı

`.env.local` içine:

```
NEXT_PUBLIC_VAPID_PUBLIC_KEY=<public>
```

Sonra uygulamada **Bildirimler → "Tarayıcı bildirimlerini etkinleştir"**.
Bu işlem izni ister, service worker'ı kaydeder ve aboneliği
`POST /api/push/subscriptions` ile tabloya yazar.

---

## 3. Share storage (mevcut)

1. `supabase/migrations/202609250001_create_share_snapshots.sql` çalıştırılır.
2. `share-images` bucket'ı **private** olmalı (migration oluşturur).
3. `share-media` bucket'ı reel videoları için **private**;
   `SUPABASE_SHARE_MEDIA_BUCKET=share-media`.
4. `.env.example` → `.env.local`; `SUPABASE_URL` ve `SUPABASE_SECRET_KEY`
   girin.

Share snapshot'ında `blob:` / `idb:` / `idb-video:` referansı **asla**
saklanmaz; istemci bu baytları çözer, sunucu private storage'a yükler ve
snapshot'a yalnızca `storage:` referansı yazar. Böylece bağlantı başka
cihazda açılabilir.

---

## 4. Ortam değişkenleri özeti

| Değişken | Nerede | Gizli mi? |
| --- | --- | --- |
| `SUPABASE_URL` | server | hayır |
| `SUPABASE_SECRET_KEY` | server | **evet** |
| `SUPABASE_SHARE_BUCKET` | server | hayır |
| `SUPABASE_SHARE_MEDIA_BUCKET` | server | hayır |
| `SHARE_TTL_DAYS` | server | hayır |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | client | hayır (public anahtar) |
| `VAPID_PRIVATE_KEY` | Edge Function secret | **evet** |

---

## 5. Cross-device senaryosu

Migration uygulandıktan sonra:

```
Bilgisayar A → marka → aylık plan → takvim kaydı
Bilgisayar B → aynı backend → aynı kayıt görünür
```

localStorage yalnızca Supabase **erişilemediğinde** devreye giren
fallback/cache'tir; production source of truth Supabase'tir.