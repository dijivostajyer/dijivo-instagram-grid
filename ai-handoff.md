\# AI HANDOFF — Dijivo Instagram Grid Preview Tool



> Bu dosya projenin kalıcı bağlamı ve AI devir teslim kaynağıdır. Yeni bir AI, geliştirmeye başlamadan önce bu dosyanın tamamını okumalı; ardından kodu inceleyerek güncelliğini doğrulamalıdır.



\## 1. Proje Amacı



Dijivo ekibinin planlanan Instagram içeriklerini, markanın mevcut profil gönderileriyle birlikte gerçekçi bir \*\*3 sütunlu profil gridinde\*\* görmesini sağlayan dahili bir araç geliştirmek.



Araç, müşteriye gönderilmeden önce içerik kapaklarının profil görünümündeki uyumunu kontrol etmeyi; sonucu Dijivo şablonunda A4 PDF/JPG olarak dışa aktarmayı ve salt-okunur bağlantıyla paylaşmayı kolaylaştırır.



Bu araç bir sosyal medya yayınlama veya takvim ürünü değildir. RADAAR takvim, planlama ve tekil gönderi önizleme ihtiyaçlarında kullanılmaya devam edebilir; bu proje özellikle toplu Instagram profil-grid sunumu ihtiyacını karşılar.



\## 2. Seçilen Teknik Yaklaşım



\- \*\*Uygulama:\*\* Next.js (App Router) + TypeScript

\- \*\*Arayüz:\*\* React + Tailwind CSS

\- \*\*Veri erişimi:\*\* İlk sürümde yerel/proje tabanlı veri ve dosya yükleme; kalıcı sunucu veritabanı zorunlu değildir.

\- \*\*Görsel işleme:\*\* Tarayıcı tarafında düzenleme/önizleme; sunucu tarafında güvenilir PDF/JPG üretimi.

\- \*\*PDF üretimi:\*\* A4, yüksek çözünürlüklü ve baskıya uygun çıktı üreten bir kütüphane/servis.

\- \*\*Paylaşım:\*\* Tahmin edilmesi zor bir token içeren, yalnızca görüntüleme yetkili bağlantı.



Teknik seçim değiştirilecekse, gerekçe `## 13. Karar Kaydı` bölümüne eklenmeden mimari değiştirilmez.

### Cross-device workspace güvenlik kararı (2026-10-08)

Workspace kalıcılığı Supabase Auth ile tek kullanıcı/tek hesap modeli kullanır. Tüm `workspace_*` satırları `user_id = auth.uid()` RLS politikasıyla scope edilir; rol veya anonymous access yoktur. `workspace-media` private bucket’tır ve nesne path’inin ilk segmenti kullanıcının UUID’sidir. Tarayıcı yalnız anon/publishable anahtarı ve kendi Auth oturumunu kullanır; service-role anahtarı browser bundle’ına girmez. İlk login’de uzak workspace boşsa eski local veri güvenli biçimde aktarılır, aksi halde uzak veri tercih edilir ve local fallback korunur.



\## 3. Kesinleşen Kararlar



1\. RADAAR incelendi: içerik takvimi ve tek gönderi önizlemesi mevcut olsa da, istenen kapsamda Instagram profil grid planner ve Dijivo sunum çıktısı sağlamıyor.

2\. Bu nedenle özel Dahili Dijivo aracı geliştirilecek.

3\. Temel görünüm, Instagram profilinin 3 sütunlu grid mantığını yansıtacak.

4\. Planlanan içerikler, mevcut profil içerikleriyle aynı gridde birlikte değerlendirilecek.

5\. Sabitlenmiş (pinned) gönderiler görünüm ve sıralama hesabına dahil edilecek.

6\. Sunum çıktısı Dijivo marka şablonunda, \*\*A4 PDF ve JPG\*\* olarak alınabilecek.

7\. Müşteri/ekip paylaşımı için salt-okunur paylaşım bağlantısı sağlanacak.

8\. Hiçbir API anahtarı, parola, erişim tokenı veya müşteri gizli verisi bu dosyada ya da kaynak koda sabit yazılmayacak.



\## 4. İlk Sürüm Kapsamı (MVP)



\- Marka/proje oluşturma veya seçme.

\- Marka adı, kullanıcı adı, profil görseli ve isteğe bağlı kısa açıklama alanları.

\- Mevcut Instagram gönderilerini görsel ve yayın sırasıyla ekleme.

\- Planlanan gönderilerin kapak görsellerini ekleme.

\- Planlanan gönderileri sürükle-bırak veya açık sıra kontrolü ile dizme.

\- Mevcut ve planlanan içerikleri tek bir 3 sütunlu profil görünümünde gösterme.

\- Sabitlenmiş gönderileri görünür biçimde işaretleme ve grid sıralamasına doğru yansıtma.

\- Grid görünümünü Dijivo şablonlu A4 PDF ve JPG olarak dışa aktarma.

\- Salt-okunur paylaşım linki üretme ve görüntüleme.

\- Boş durumlar, yükleme hataları ve desteklenmeyen görseller için anlaşılır kullanıcı mesajları.



\## 5. Instagram Grid Kuralları



\### Temel sıralama



\- Grid her zaman \*\*3 sütundan\*\* oluşur.

\- Görsel sunumda en yeni içerik üst solda başlar; sıralama soldan sağa, sonra üstten alta ilerler.

\- Yeni planlanan içerik yayınlanma sırasına göre mevcut gridin üstüne eklenir. Arayüzde kullanıcının gördüğü sonuç ile dışa aktarılan sonuç birebir aynı olmalıdır.

\- Eksik satırlar boş hücrelerle dengelenmez; grid doğal akışında gösterilir.



\### Sabitlenmiş gönderiler



\- Instagram profilinin üst kısmında en fazla \*\*üç\*\* sabitlenmiş gönderi konumu desteklenir.

\- Sabitlenen gönderiler normal tarih sırasından bağımsız olarak en üst satırda gösterilir.

\- Sabitlenmiş içeriklerin kendi soldan-sağa sırası kullanıcı tarafından belirlenebilir olmalıdır.

\- Sabitlenmemiş içerikler, sabit alanın altından normal en-yeniden-en-eskiye akışla devam eder.

\- Bir içerik sabitlenince veya sabitliği kaldırılınca grid anında yeniden hesaplanmalıdır.



\### Görsel oranlar ve güvenlik



\- Grid hücreleri Instagram profil karesi gibi \*\*1:1\*\* kırpılmış önizleme sunar; orijinal görsel dosyası değiştirilmez.

\- 3:4 oranlı planlanan tasarımlar gridde merkezden kırpılarak gösterilir; dışa aktarılan sunumda 3:4 içerik görseli ayrıca/uygun şekilde korunmalıdır.

\- Kullanıcıya kırpma etkisini gösteren net önizleme sağlanır.

\- Dosya boyutu, türü ve görüntü yüklenememe hataları doğrulanır.



\## 6. Dışa Aktarma ve Paylaşım Gereksinimleri



\### A4 PDF



\- A4 sayfa ölçüsünde üretilir.

\- Dijivo logosu/marka şablonu için ayrılmış güvenli alan kullanılır.

\- En az marka adı, Instagram kullanıcı adı, oluşturma tarihi ve grid görünümü yer alır.

\- Çıktı okunabilir, kesintisiz ve yüksek çözünürlüklü olmalıdır.



\### JPG



\- PDF ile aynı bilgi ve aynı grid durumunu yansıtır.

\- Paylaşımda okunabilir olacak yeterli piksel çözünürlüğünde hazırlanır.



\### Salt-okunur paylaşım linki



\- Link alıcıya düzenleme, silme veya yeni içerik yükleme izni vermez.

\- Link, doğru marka ve grid sürümünü açar.

\- Gerekiyorsa sonradan geçersizleştirilebilecek şekilde tasarlanır.

\- Tahmin edilebilir artan numaralar veya müşteri bilgisini açığa çıkaran URL’ler kullanılmaz.



\## 7. Kapsam Dışı — Faz 2 ve Sonrası



\- Instagram/Meta hesabına OAuth ile bağlanma ve otomatik profil içeriği çekme.

\- Gönderi yayınlama, zamanlama veya onay akışı.

\- RADAAR veya başka araçlarla canlı entegrasyon.

\- Çok kullanıcılı rol/yetki yönetimi ve ekip içi yorumlaşma.

\- Gelişmiş analitik, erişim/etkileşim metrikleri.

\- Çoklu sosyal ağ gridleri (TikTok, LinkedIn vb.).

\- Sürüm geçmişi, karşılaştırma ekranları ve gelişmiş şablon editörü.

\- Otomatik yapay zekâ tasarım önerileri.



Faz 2 maddeleri MVP’yi geciktirecek biçimde eklenmez. Yeni bir ihtiyaç geldiğinde önce bu listeye mi, MVP’ye mi ait olduğu değerlendirilir.



\## 8. Geliştirme Sırası



1\. Proje iskeleti, TypeScript kuralları, temel tasarım sistemi ve örnek veri.

2\. Marka/proje modeli ile mevcut ve planlanan içerik veri modelinin kurulması.

3\. 3 sütunlu grid hesaplama motoru; normal sıra ve pinned kurallarının birim testleri.

4\. Görsel yükleme, 1:1 grid kırpma önizlemesi ve planlanan içerik sıralama arayüzü.

5\. Marka bilgileri, grid görünümü ve boş/hatalı durumların tamamlanması.

6\. A4 PDF ve JPG üretimi; tasarım doğrulaması.

7\. Salt-okunur paylaşım görünümü ve erişim tokenı.

8\. Uçtan uca test, kabul listesi ve gerçek örnek marka verisiyle son kontrol.



\## 9. Test ve Kabul Kontrol Listesi



\- \[ ] Grid her genişlikte 3 sütunla, bozulmadan görüntüleniyor.

\- \[ ] 0, 1, 2, 3, 8, 9, 10 ve daha fazla içerik ile sıralama doğrulandı.

\- \[ ] En yeni içerik konumu ve yayın sırası doğru.

\- \[ ] 0–3 pinned gönderi normal akışı doğru şekilde etkiliyor.

\- \[ ] Pinned gönderinin sırası değiştirilince grid doğru güncelleniyor.

\- \[ ] Planlanan gönderi ekleme, silme ve yeniden sıralama çalışıyor.

\- \[ ] Dikey 3:4, kare, yatay ve hatalı görseller için davranış test edildi.

\- \[ ] Grid kırpma önizlemesi kullanıcıya anlaşılır.

\- \[ ] PDF A4 ölçüsünde, marka bilgileriyle ve kesilme olmadan açılıyor.

\- \[ ] JPG dışa aktarımı PDF’deki grid ile aynı durumu gösteriyor.

\- \[ ] Paylaşım linki düzenleme kontrollerini göstermiyor ve doğrudan düzenleme yapamıyor.

\- \[ ] Geçersiz/iptal edilmiş paylaşım linki güvenli hata ekranı gösteriyor.

\- \[ ] Mobil ve masaüstü temel akışları kontrol edildi.

\- \[ ] Erişilebilirlik: klavye ile temel işlem, anlamlı etiketler ve yeterli kontrast kontrol edildi.

\- \[ ] Hiçbir gizli anahtar, parola veya gerçek müşteri tokenı repoda bulunmuyor.



\## 10. Gelecekteki AI Ajanları İçin Çalışma Kuralları



1\. Önce bu dosyayı tamamen oku; sonra mevcut kod ve testlerle bilgileri doğrula.

2\. Çalışan yapıyı sıfırdan kurma, gereksiz teknoloji değişikliği yapma veya mevcut tasarımı gerekçesiz bozma.

3\. MVP dışı bir istek geldiğinde bunu Faz 2 listesine eklemeyi varsay; kapsam değişimi için kullanıcıdan yönlendirme iste.

4\. Grid sıralama/pinned davranışında değişiklik yapmadan önce ilgili birim testlerini yaz veya güncelle.

5\. Her değişiklikte hata durumlarını, mobil görünümü ve dışa aktarma çıktısını etkileyip etkilemediğini kontrol et.

6\. Gizli bilgileri `.env` benzeri yerel yapılandırmada tut; bunları asla commit etme veya bu dosyaya yazma.

7\. Büyük mimari, veri modeli veya kullanıcı deneyimi kararı alınırsa `## 13. Karar Kaydı` bölümünü güncelle.

8\. Bir görev tamamlandığında `## 12. Zorunlu Devir Teslim / Durum Güncellemesi` bölümünü güncellemek zorunludur.



\## 11. Bilinen Açık Noktalar



\- Dijivo’nun kesin logo, renk, tipografi ve A4 şablon varlıkları henüz projeye eklenmemiş olabilir. Geçici marka alanları kullanılabilir; nihai varlık geldiğinde çıktı şablonu güncellenmelidir.

\- MVP’de mevcut profil içeriklerinin manuel yüklenmesi/eski verinin içe aktarılması tercih edilir. Meta bağlantısı Faz 2’dir.

\- Paylaşım linklerinin saklama süresi ve geçersizleştirme arayüzü ürün sahibiyle netleştirilecektir.



\## 12. Zorunlu Devir Teslim / Durum Güncellemesi



Her AI, işi bırakmadan veya bir görevi tamamladıktan sonra bu bölümü günceller. Bilinmeyen alanlar boş bırakılmaz; `Yok`, `Test edilmedi` veya gerekçe yazılır.



\### Güncel durum


\- \*\*Son güncelleme:\*\* 2026-10-08 (notification/reminder sistemi kaldırıldı)

\- \*\*Güncelleyen:\*\* Buffy (AI) — notification/reminder kaldırma



\-\*\*Aktif iş:\*\* Takvim bildirim/hatırlatma sisteminin tamamen kaldırılması. Saf planlama sistemi (Ay/Hafta/Gün, Post/Reel/Story/Not/Görev, tarih/saat, scheduled_at, drag/drop, edit, delete, checklist, Grid Planner bağlantısı, Dashboard Bugünkü Plan/Yaklaşanlar, brand/project izolasyonu, Supabase calendar persistence) korunur; tüm notification/reminder altyapısı (NotificationCenter, bildirim zili, unread count, markRead/markAllRead, reminder polling, reminder deliveries, deliveries API route'ları, browser push, PushManager, service worker push/notificationclick, /api/push/subscriptions, push_subscriptions, reminder_deliveries, reminder-dispatch Edge Function, cron/pg_net, VAPID, CRON_SECRET, reminderOffsetMinutes/reminder_offset_minutes/remind_at, PlanningForm içi hatırlatma UI) kaldırıldı.: masaüstünde medya paneli + merkez Instagram preview + detay/aksiyon paneli; mobilde preview önce, içerikler ve aksiyonlar sonra gelir. Profil ayarları drawer'a taşındı; Escape ile kapanır. Mevcut persistence, share, export ve grid algoritmaları korunmuştur.

\- \*\*Son doğrulama:\*\* Browser smoke: desktop ve 390px mobil görünümde taşma yok; planlanan içerik liste DnD ile sıralandı, yenileme sonrasında sıra korundu ve demo sırasına geri alındı. Profil drawer, seçili içerik detayı ve responsive panel sırası kontrol edildi. `npm run typecheck` başarılı; `npm test` **92/92** başarılı; `npm run build` başarılı. Production deployment smoke henüz yapılmadı.

\- \*\*Tamamlananlar:\*\*
  \- Next.js 15 (App Router) + TypeScript + Tailwind CSS v4 iskeleti kuruldu; Vitest test altyapısı eklendi.
  \- Veri modeli: `Brand`, `ExistingPost` (recencyIndex, pinned, pinnedOrder), `PlannedPost` (planOrder), `GridCell`, `GridResult` (`src/lib/types.ts`).
  \- 3 sütunlu grid motoru: en-yeni-üst-solda sıralama; en fazla 3 pinned, pinnedOrder'a göre soldan sağa; planlananlar planOrder'a göre mevcut akışın üstünde; boş hücre doldurulmuyor (`src/lib/grid.ts`).
  \- 15 birim testi: temel sıralama, pinned kuralları (3+ pinned, sırasız pinned, pin kaldırma), mevcut+planlanan karışımı ve sınır durumları (`src/lib/grid.test.ts`).
  \- Sade temel arayüz: marka başlığı, 1:1 kırpılmış grid, pinned/planlanan etiketleri ve boş durum (`src/app/page.tsx`, `src/components/GridPreview.tsx`, `src/app/layout.tsx`, `src/app/globals.css`).
  \- Demo marka/gönderi verisi eklendi (`src/data/sample-data.ts`); gerçek müşteri verisi ve gizli bilgi içermez.
  \- **Aşama 2 — içerik yönetimi:** Görsel yükleme doğrulaması: tür (JPG/PNG/WebP), 10 MB boyut sınırı, boş dosya ve decode testi; Türkçe hata mesajları (`src/lib/validators.ts`).
  \- Gönderi işlemleri: mevcut ekleme ("en yeni"/"en eski" recency kontrolü), silme (recency yeniden yazımı), pin/unpin (3 limit + Türkçe hata), pinned soldan-sağa taşıma ve yeniden sıralama; planlanan ekleme (planOrder 0), silme ve sürükle-bırak sırası (`src/lib/post-ops.ts`).
  \- Bileşenler: `BrandEditor` (ad, kullanıcı adı, bio, profil görseli), `ExistingPostList` (yükleme, pin/unpin, ←/→ taşıma, silme), `PlannedPostSorter` (dnd-kit sürükle-bırak; klavye sensörü destekli), `GridManager` (tüm sayfa durumu; listeler planOrder/recencyIndex'e göre türetilir), `GridPreview` (hücre başına yüklendi/hata durumu; önbellekten gelen görseller için mount sonrası `complete` kontrolü).
  \- Görseller tarayıcıda Object URL ile önizlenir; orijinal dosya değişmez. Veri yalnızca sayfa oturumunda tutulur (yenilemede kaybolur; bu aşamada bilinçli).
  \- **Aşama 3 — PDF/JPG dışa aktarma:** Paylaşılan `renderExportPage()` hem PDF hem JPG'yi aynı yüzeyden üretir:72pt dairesel profil avatarı, marka adı, `@kullanıcı adı`, bio, tarih, sayfa numarası footer'ı.
  \- Gerçek A4 PDF: sayfa canvas'ta render edilir, PNG gömülür; `pdf-lib` `PDFDocument.create()` + `addPage([A4_W, A4_H])` ile üretilir; çıktı `%PDF-1.7` ile başlar `%%EOF` ile biter (indirilen dosyada doğrulandı).
  \- Gerçek JPG: `canvas.toBlob("image/jpeg")` → Base64 → `base64ToBytes`; `FF D8 FF` magic, canvas açıkça `A4*2` (1191×1684); çok sayfalı export'ta sayfalar tuvale dikey istiflenir.
  \- A4 pagination: `calculatePagination` ile `rowsPerPage` (A4'te3 satır = 9 hücre/sayfa), `cellsPerPage = rowsPerPage * 3`, `pageCount = ceil(cells/cellsPerPage)`; her sayfada yalnızca o sayfanın hücreleri çizilir.
  \- Gerçek 1:1 `object-cover` crop: `calculateSquareCrop` sourceSize = min(w,h), source rect merkezden; `drawImage`9 argümanla hücre hedefine çizilir.
  \- Export görselleri `grid.cells` sırasıyla `GridManager`'den gelir (`imageUrls={imageUrls}`), `crossOrigin="anonymous"` ile yüklenir (aksi halde canvas taint → toBlob SecurityError).
  \- Hatalar `ExportPanel` içinde satır içi gösterilir; UI thread'ini bloklayan `alert()` kaldırıldı.
  \- **Aşama 4 — veri kalıcılığı:** `src/lib/storage.ts` — sürüm damgalı (`STORAGE_VERSION=1`) JSON metaverisi; `serializeAppState`/`deserializeAppState` (bozuk veri/yanlış sürüm → `null` → demo varsayılanları), `loadAppState`, `writePersistedState`/`clearPersistedState` (`StorageLike` enjekte edilebilir), `toPersistableState` (`blob:` → `idb:` dönüşümü/filtresi).
  \- `src/lib/image-store.ts` — IndexedDB (`dijivo-image-store`/`images`) Blob deposu: `persistObjectUrl`, `loadImageAsObjectUrl`, `clearStoredImages`; `idb:<id>` referans yardımcıları.
  \- `src/hooks/use-persisted-grid.ts` — yükleyen/yazan/sıfırlayan hook: açılışta kayıtlı veri + görsel Blob'ları yüklenir, `ready` öncesi yazma yapılmaz, yükleme sonrası object URL'ler `refByObjectUrl` haritasında tutulur, sıfırlamada localStorage + IndexedDB temizlenir ve object URL'ler revoke edilir.
  \- **Lifecycle cleanup:** Silinen mevcut/planlanan yüklemeler ile değiştirilen/kaldırılan profil görsellerinin `idb:` referansı `refByObjectUrl` eşlemesinden çözülür; başka aktif kullanım yoksa `deleteStoredImage()` ile Blob silinir ve object URL `URL.revokeObjectURL()` ile serbest bırakılır. HTTP/HTTPS demo URL'leri etkilenmez. Reset/unmount URL cleanup'ı hata yalıtımlıdır.
  \- `GridManager` kalıcılığı dışarıdan alır (state + `persistUpload` + `resetToDefaults`); "Verileri sıfırla (demo verilere dön)" bölümü eklendi.
  \- Boş grid export koruması: `getExportAvailability` — butonlar `disabled` ve "Grid boş: …" açıklaması görünür.
  \- **Aşama 5 — salt-okunur paylaşım:** `ShareSnapshot` strict doğrulaması, UUID token helper'ı ve `ShareStore` sözleşmesi eklendi. `InMemoryShareStore` geçici adapter'ı snapshot JSON'unu tek Node sürecinde tutar; `/api/shares` snapshot oluşturur, `/share/[token]` ortak `GridPreview` ile salt-okunur gösterir. Snapshot editör değişikliklerinden bağımsızdır; `blob:` görseller taşınabilir `data:` URL'e çevrilir, `idb:`/`blob:` referansları reddedilir.
  \- **Aşama 6 — production share storage:** `SupabaseShareStore`, `ShareStore` abstraction'ını koruyarak private `share-images` bucket'ına data URL upload'larını taşır; payload yalnızca `storage:<path>` veya external HTTP(S) referansı saklar. Sayfa açılışında private yollar server-side 3600 saniyelik signed URL'e çözülür. `SHARE_TTL_DAYS` (varsayılan 30) expiry, `revoke(token)` revoked_at desteği, upload/DB hata rollback'i ve 60 hücre / 10 MB tek görsel / 20 MB toplam sınırları eklendi. Production eksik env'de memory fallback yapılmaz.
  \- **Production integration fix:** DB insert artık migration ile uyumlu olarak `version: snapshot.version` ve `created_at: snapshot.createdAt` yazar; fake driver testi bu zorunlu alanları doğrular. `getShareStore()` credential varsa development/production fark etmeksizin Supabase seçer; credential yoksa yalnız development/test memory kullanır, production kontrollü hata verir. Özel `SUPABASE_SHARE_BUCKET` desteklenir; migration yalnız default `share-images` bucket'ını kurar ve özel bucket için aynı private/MIME/10 MB ayarlarının ayrıca yapılması gerekir.
  \- **Upload hardening:** Data URL upload'ları sıralı yapılır; hata olduğunda o ana kadar yüklenmiş bütün path'ler temizlenir ve başlanmamış upload kalmaz. PNG/JPEG/WebP MIME değeri decoded binary imzasıyla doğrulanır. Create DB insert sonrası signed URL üretmez; immutable `storage:` referansını döner, 3600 sn signed URL yalnız `get()`/share page okunurken üretilir.

\- \*\*Değiştirilen dosyalar:\*\* Aşama 2: `package.json`, `package-lock.json` (@dnd-kit/core, @dnd-kit/sortable, @dnd-kit/utilities eklendi), `src/lib/validators.ts`, `src/lib/validators.test.ts`, `src/lib/post-ops.ts`, `src/lib/post-ops.test.ts`, `src/components/BrandEditor.tsx`, `src/components/ExistingPostList.tsx`, `src/components/PlannedPostSorter.tsx`, `src/components/GridManager.tsx`, `src/components/GridPreview.tsx`, `src/app/page.tsx`, `AI-HANDOFF.md`. Önceki aşamadan: `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`, `vitest.config.ts`, `.gitignore`, `src/lib/types.ts`, `src/lib/grid.ts`, `src/lib/grid.test.ts`, `src/app/layout.tsx`, `src/app/globals.css`, `src/data/sample-data.ts`. Aşama 3: `src/lib/export.ts`, `src/lib/export.test.ts`, `src/lib/order.test.ts`, `src/components/ExportPanel.tsx`, `src/components/GridManager.tsx`, `ai-handoff.md`, `.gitignore` (`dev.log` git index'inden çıkarıldı `git rm --cached`). Aşama 4: `src/lib/storage.ts`, `src/lib/storage.test.ts`, `src/lib/image-store.ts`, `src/hooks/use-persisted-grid.ts`, `src/lib/export.ts` (`getExportAvailability`), `src/lib/export.test.ts`, `src/components/GridManager.tsx`, `src/components/ExportPanel.tsx`, `ai-handoff.md`. Lifecycle cleanup: `src/lib/image-lifecycle.ts`, `src/lib/image-lifecycle.test.ts`, `src/lib/image-store.ts`, `src/hooks/use-persisted-grid.ts`, `src/components/BrandEditor.tsx`, `ai-handoff.md`.
\- \*\*Final UI/UX polish dosyaları:\*\* `src/app/globals.css`, `src/components/BrandEditor.tsx`, `src/components/ExistingPostList.tsx`, `src/components/ExportPanel.tsx`, `src/components/GridManager.tsx`, `src/components/GridPreview.tsx`, `src/components/PlannedPostSorter.tsx`, `src/components/SharePanel.tsx`, `ai-handoff.md`. Yeni bağımlılık, kalıcılık/paylaşım/export mimarisi veya grid sıralama algoritması eklenmedi.

\- \*\*Testler ve sonuçları:\*\* `npm run typecheck`: 0 hata. `npm test` (Vitest): **292/292 geçti** (notification/reminder kaldırma + test güncellemeleri). `npm run build`: başarılı. Kaldırılan notify/reminder testleri uygun şekilde güncellendi; kalıcılık, share, export, grid algoritmaları ve multi-brand davranışları korunmuştur. Production deployment smoke henüz yapılmadı.

\- \*\*Bilinen engel/risk:\*\* Nihai Dijivo marka varlıkları ve paylaşım linki saklama politikası netleşmeli. Veri kalıcılığı4. aşama ile eklendi (localStorage metaveri + IndexedDB Blob'lar); eski "veri kalıcılığı yok" kısıtı geçersiz. dnd-kit SSR'da aria-describedby hydration uyarısı üretebilir; sürükleme tutamacında `suppressHydrationWarning` ile bastırıldı. Demo görselleri placehold.co'dan geldiği için çevrimdışı gösterimde yüklenmez. 3+ pinned gönderinin "normal akışa düşme" davranışı ürün sahibiyle teyit edilecek. Export riski: çok sayfalı JPG'te tuval yüksekliği `A4*2*pageCount` piksel olur; ~10+ sayfada tarayıcı tuval boyut sınırı aşılabilir (kısmi test edilmedi). Cross-origin görsel CORS desteklemiyorsa export görsel yükleme hatası verir (bilinçli, satır içi hata mesajı gösterilir). Production deployment henüz yapılmadı; sıradaki aşama production deployment smoke testidir.



\- \*\*Aşama 5 dosyaları:\*\* `src/lib/share-token.ts`, `src/lib/share.ts`, `src/lib/share-store.ts`, `src/lib/share-client.ts`, `src/lib/share.test.ts`, `src/app/api/shares/route.ts`, `src/app/share/[token]/page.tsx`, `src/components/SharePanel.tsx`, `src/components/GridManager.tsx`, `ai-handoff.md`.

\- \*\*Aşama 5 doğrulaması:\*\* `npm run typecheck` 0 hata; `npm test` 82/82 geçti; `npm run build` başarılı (`/api/shares`, `/share/[token]` dinamik route). Testler token, strict snapshot serialize/validation, brand/grid sırası-pinned-kaynak bilgisi, boş grid reddi, invalid/bulunamayan token, bozuk snapshot fallback, immutable davranış ve `blob:`/`idb:` reddini kapsar. Tarayıcı smoke: link yeni sekmede aynı 8 hücre / 3 satır / 2 pinned görünümü ve edit kontrolü olmadan açıldı; geçersiz token güvenli hata ekranına düştü; editörde marka değişse de eski snapshot değişmedi.

\- \*\*Production storage/deployment gereksinimi:\*\* `InMemoryShareStore` tek uygulama sürecinin belleğinde yaşar; restart/deploy sonrası kayıtlar kaybolur ve çoklu instance/serverless dağıtımında farklı instance'a giden istek snapshot'ı bulamaz. Bu MVP yalnızca aynı çalışan uygulama örneğine yönlendirilen istemciler arasında çalışır. Gerçek cross-device garanti için shared database, görseller için object storage/CDN adapter'ı, TTL/revocation ve çoklu-instance uyumu gerekir. `data:` URL'e çevrilen upload'lar request/memory boyutunu artırır.

\### Sonraki AI ne yapmalı?



1\. Production share storage adapter'ına geç: `InMemoryShareStore` yerine shared database + object storage/CDN kullan; token TTL/revocation ve çoklu-instance davranışını tasarla. Kalıcılık tarafında kalıcı görsel silinirse ilgili gönderi metaveriden düşer; kullanıcıya "görsel bulunamadı" ayrıntısı eklenebilir.

2\. Grid sıralama veya pinned davranışında değişiklik yapmadan önce `src/lib/grid.test.ts` ve `src/lib/post-ops.test.ts` içindeki birim testleri güncelle; yeni davranışı önce testle sabitle.

3\. Her değişiklikten sonra `npm test`, `npm run typecheck` ve `npm run build` çalıştır. Not: `next build`, çalışan dev sunucusu varken `.next` önbelleğini bozabiliyor; build öncesi dev sunucusunu durdur ya da build sonrası `rm -rf .next` yapıp dev'i yeniden başlat. Sonuçları ve sonraki somut adımı bu bölüme ekle.



\### Güncelleme şablonu



```md

\- \*\*Son güncelleme:\*\* YYYY-AA-GG

\- \*\*Güncelleyen:\*\* \[AI/kişi adı]

\- \*\*Aktif iş:\*\*

\- \*\*Tamamlananlar:\*\*

\- \*\*Değiştirilen dosyalar:\*\*

\- \*\*Testler ve sonuçları:\*\*

\- \*\*Bilinen sorunlar/riskler:\*\*

\- \*\*Sonraki somut adım:\*\*

```



\- **Son güncelleme:** 2026-09-30
\- **Aktif iş:** Original-scope completion (özellik kapsama tamamlama).
\- **Tamamlananlar:** Profil istatistikleri ve öne çıkanlar; post/reel/carousel metadata ve gösterge; çoklu planlanan görsel yükleme; aylık proje seçimi/oluşturma ve v1→v2 migration; immutable share snapshot'a yeni alanlar; share revoke UI/endpoint; A4 300 DPI raster export.
\- **Değiştirilen dosyalar:** `src/lib/types.ts`, `storage.ts`, `post-ops.ts`, `validators.ts`, `share.ts`, `share-client.ts`, `export.ts`, `use-persisted-grid.ts`; ilgili bileşenler, share route/page ve iki test dosyası.
\- **Testler ve sonuçları:** `npm run typecheck` PASS; `npm test` 94/94 PASS; `npm run build` PASS.
\- **Manuel smoke:** Tarayıcı otomasyon bağlantısı kapanırken localhost dev server 500 döndü; production build başarılıdır, fakat bu oturumda görsel smoke tamamlanamadı.
\- **Gerçek riskler:** Aylık proje kopyasında görsel Blob referansları ortak kullanılır; aktif proje silinmediği sürece güvenlidir, fakat tüm projeler arası ref-count cleanup için ek regression testi gerekir. PDF sayfa içe aktarma ağır bir rasterizer dependency olmadan desteklenmez ve ertelendi.
\- **Sonraki görev:** Final UI revamp.

\- **Kritik takip güncellemesi:** `.next` temizlenip dev server yeniden başlatılınca localhost 500 hatası kayboldu ve `/` 200 döndü; kök neden stale cache/eski dev süreciydi, uygulama kodu hatası değildi. `hydrateState()` artık her projenin profil/highlight/post görsellerini çözerek aynı `idb:` ref için tek object URL eşlemesi kullanır. Lifecycle ref toplama tüm projeleri ve highlight kapaklarını kapsar; başka projede kullanılan Blob silinmez. Önceki ay kopyalama hedef ayın gerçek önceki ayını arar (Ocak→Aralık); aynı ay adaylarında `updatedAt` en yeni olan seçilir. Highlight kapakları mevcut JPG/PNG/WebP doğrulama ve IndexedDB zinciriyle eklenebilir/kaldırılabilir. Kaynak oran korunur, profil grid'i 1:1 Instagram preview olarak gösterilir. Export için 300 DPI `2480×3508` A4 assertion eklendi. Revoke endpoint capability-token modelindedir: token'ı bilen çağıran revoke edebilir; auth/owner capability henüz yoktur ve bu bilinen sınırlamadır. Son doğrulama: typecheck PASS, 104/104 test PASS. Browser automation transport kapalı kaldığından zorunlu gerçek UI smoke ve Project A/B shared-image browser senaryosu bu oturumda tamamlanamadı; final UI revamp sonraki faz olarak kalır.

- **Tarayıcı kabul testleri (2026-10-01):** Kullanıcının 22 maddelik fonksiyonel browser test listesi tamamlandı, hepsi PASS (Chromium, `npm run dev`): highlight kapak yükleme + F5 kalıcılığı; mevcut gönderi yükleme; Reel/Carousel tip seçimi ve grid rozetleri; pin/unpin ve 3 pin limiti ("Sabitlenmiş gönderi limiti dolu. Yeni bir pin için önce birini kaldırın."); çoklu planned upload (3→5); klavye ile planned DnD sıralama (sıra değişimi doğrulandı); F5 sonrası tüm verilerin korunması; yeni ay oluşturma (boş grid, export/paylaşım doğru devre dışı); önceki ay kopyalama — negatif: hedefin gerçek bir önceki ayı yoksa "Önceki aya ait kopyalanacak proje bulunamadı." hatası, pozitif: Ekim→"Kasım Kopya" tam kopya (11 hücre, pin, türler, highlight dahil); projeler arası geçiş; **kritik shared-image senaryosu**: Ekim'den silinen `idb:` görsel Kopya'da yaşamaya devam etti, F5 sonrası da silinmedi (ref-count lifecycle doğru çalışıyor); PDF (`%PDF-` başlangıç + `%%EOF` bitiş, 278 KB), JPG (`FF D8 FF`; 10 hücre/2 sayfa → 2480×7016 = 2×3508; 1 hücre/1 sayfa → tam 2480×3508, "Dosyalar indirildi." bildirimi); paylaşım linki oluşturma, gizli sekmede salt-okunur açılış (12 görsel yüklendi, edit butonu yok), revoke ("Paylaşım bağlantısı kaldırıldı."), revoke sonrası güvenli hata ekranı. Console/network: hata yok (yalnız React DevTools bilgisi); dev sunucusu logunda hata yok. `npm run typecheck` 0 hata; `npm test` **104/104**; `npm run build` başarılı (dev sunucusu build sırasında durduruldu, ardından aynı port 53728'de yeniden başlatıldı — aynı origin'de test verisi korunur). Kod değişikliği yok, yalnızca test + bu kayıt. Bilinen minör notlar: revoke edilen link HTTP 200 ile hata ekranı döndürüyor (404/410 olabilir, ertelendi); proje silme UI'ı yok; aynı ay için ikinci proje tekrar oluşturulabiliyor (bilinçli görünüyor, teyit edilebilir).

- **Final panel UI fazı (2026-10-01, `design/final-pdf-aligned-ui`):** Tek ekranlı MVP, gerçek uygulama paneline dönüştürüldü; veri/business logic değişmedi. **Mimari:** `GridManager` artık uygulama kontrolcüsü — tüm handler'lar (yükleme, pin, sıralama, proje, sıfırlama, paylaşım) onda; ekranlar yalnızca sunum. **Yeni bileşenler:** `AppSidebar` (7 bölümlü koyu sidebar: Genel Bakış, Aylık Planlar, Grid Planner, Marka Profili, Paylaşım, Dışa Aktarma, Ayarlar; masaüstünde `lg+` sabit, mobilde `role=dialog` drawer + Escape), `AppTopbar` (sayfa başlığı, kaydedildi göstergesi, kalıcı `#project-select`), `DashboardOverview` (varsayılan ekran: istatistik kartları, son proje + "Projeye devam et", aylık plan kartları), `MonthlyProjects` (ay bazlı gruplu proje listesi, `ProjectCreator` burada, aynı ayda birden çok proje "N proje" rozetiyle), `PostInspector` (sağ panel: preview, kaynak, grid sırası, tür, pin/sil, empty state), `BrandProfilePage` (eski drawer kaldırıldı, tam sayfa), `ShareWorkspace`, `ExportWorkspace` (A4/300 DPI/sayfa sayısı/aktif proje meta + `calculatePagination`), `SettingsPage` (yerel depolama bilgisi + reset). `SharePanel` `useShareController`'a dönüştürüldü: bağlantı durumu kabukta, sayfa değişiminde kaybolmaz, dashboard paylaşım kartı da beslenir. Navigasyon route değil state (`AppView`); mevcut route'lar (`/`, `/share/[token]`, API) değişmedi. **Responsive:** 1440/1366 üç panel; 1024 sidebar + yığılmış planner; 768/390 drawer + yığınmış; 6 görünümde 0 yatay taşma (1440, 1366, 1024, 768, 390 ölçüleri tarayıcıda doğrulandı). **Bilinen UI sorunları düzeltildi:** "Görsel yükle" satırı (recency select ayrı satır `w-full`, tür+buton h-9 hizalı), proje seçimi artık kalıcı topbar kontrolü, share/export ayrı sayfalar, grid orta panel ana odak. **Regresyon (hepsi PASS, Chromium):** proje oluşturma (negatif+pozitif kopyalama), proje geçişi, F5 kalıcılığı (2 proje, highlight kapak IDB hidrasyonu, istatistik 1234, Reel/Carousel), mevcut yükleme, çoklu planned upload, DnD (klavye), pin/unpin/3 limiti, profil istatistikleri + highlight kapak, PDF (`%PDF-`/`%%EOF`), JPG (2480×7016 = 2×3508), paylaşım oluştur + gizli sekme salt-okunur (11 hücre, edit butonu yok) + revoke + ölü link ekranı, kritik shared-image (Ekim'de silinen `idb:` görsel Kasım Reg'de + F5 sonrası yaşıyor). Console/network/dev log temiz. Klavye Tab gezinme çalışır; `focus-visible` sınıfları tanımlı (CDP sentetik Tab ile `:focus-visible` eşleşmesi otomasyonla görselleştirilemedi — gerçek klavyede beklenen davranış). **Kalite:** `npm run typecheck` 0 hata; `npm test` **104/104**; `npm run build` başarılı. **Ortam notu:** Oturumlar arası test tarayıcısının localStorage'ı silinmiş (demo'ya döndü, IndexedDB blob'ları durdu); storage kodunda diff yok, sıfırlama tetiklenmedi — ortam kaynaklı; test senaryosu yeniden kuruldu. Ekran görüntüsü captur araçta bazen bayat kare döndürüyor; doğrulamalar DOM üzerinden yapıldı.

\- **Çoklu marka fazı (2026-10-01, `design/dashboard-planning-polish`):** Tek markalı araç, kurumsal çoklu marka workspace'una dönüştürüldü; grid/pinned/export/share algoritmaları ve mevcut testlerin hiçbiri zayıflatılmadı (146/146). **Veri modeli:** `BrandWorkspace` — `brands[]`, `projects[]`, `activeBrandId`, `activeProjectId`; `STORAGE_VERSION=3` v1→v3 migration mevcut kullanıcı verisini korur (migration testleri zorunlu ve eklendi). **Saf geçişler `src/lib/brand-ops.ts`:** `createBrandState`, `selectBrandState`, `selectProjectState` (brandId uyuşmazlığını reddeder — strict marka izolasyonu), `createProjectState` ("Önceki ayı kopyala" aynı markada kalır; önceki ay projesi yoksa `Önceki aya ait kopyalanacak proje bulunamadı.` hatası), `copyPostToProjectState` (tüm projelerde arar; seçenekler: ✓görsel/caption/tür/hashtagler, ☐pin; yeni ID'ler; kaynak değişmez; hedef markanın hashtag grupları caption'a eklenir; aktif-proje aynası senkron), `copyHighlightToBrandState` (yeni ID; marka girişi + o markanın TÜM projelerinin ayna girişlerine eklenir), `syncActiveProject`, `getDefaultAppState`. `use-persisted-grid` hook'u bu geçişlerin ince bir kabuğu; yeni API: `brand`, `brands`, `activeBrandId`, `selectBrand`, `setBrand`, `createBrand`, `projects`, `allProjects`, `activeProjectId`, `selectProject`, `createProject`, `copyPostToProject`, `copyHighlightToBrand`. **İlk çalışma:** marka yoksa `Onboarding` ("İlk markanızı oluşturun"); '+ Yeni Marka' butonu ve `NewBrandModal`; ortak `BrandForm` (zorunlu ad+kullanıcı adı, profil fotoğrafı yükleme, katlanabilir gelişmiş alanlar). **Topbar:** iki seviyeli Marka (`#brand-select`) + Plan (`#project-select`, `name · m/yyyy`) seçici; '+ Yeni Marka'; sayfa başlığı `VIEW_TITLES[view]`. **Dashboard:** marka bazlı hero + 6 hızlı işlem (Grid Planner, Yeni Aylık Plan, Profili Düzenle, Görsel Yükle, Paylaş, PDF · JPG) ve mini grid önizlemesi. **Marka Profili ayrımı:** Marka Profili (Instagram'da görünen: Profil / İçerik Ayarları / Hashtagler / İletişim alt sekmeleri) vs Marka Ayarları (ajans: istatistikler, öne çıkanlar — highlight'ları başka markaya kopyalama dahil); sidebar "Ayarlar" uygulama seviyesinde kalır. **Hashtag/mention/CTA:** marka bazlı hashtag grubu CRUD + caption'a ekleme (ham `#hashtag` yazımı serbest), varsayılan @mention ve CTA şablonları, post modalından tek tıkla ekleme. **`caption?: string` `Post` üzerine eklendi** (geriye dönük uyumlu; aylık plan kopyasında ve marka arası kopyada korunur). **PostModal (sağdaki PostInspector paneli KALDIRILDI):** gönderiye tıklayınca bulanık arka plan üzerine ortalanmış dialog (`role=dialog aria-modal`, backdrop/Escape kapanma, otomatik odak): büyük görsel, içerik türü, caption, hashtag grubu, mention, CTA, pin/unpin (mevcut), görsel değiştir, başka ay/markaya kopyala, sil (`window.confirm`), metadata. Sol taraf Instagram benzeri gönderi önizlemesi (avatar, @username, beğen/yorum/paylaş/bookmark ikonları, `tür · Grid sırası/toplam`, caption + renkli hashtagler, tema geçiş butonu). **Grid Planner merkezi gerçek Instagram profili görünümü:** profil fotoğrafı/ilk harf, username, displayName, bio, website (otomatik `https://` ön eki), gönderi/takipçi/takip sayaçları (`tr-TR` biçimlendirme), öne çıkanlar (gradient ring), Post/Reels sekmeleri (`role=tablist`), 3 sütunlu grid, reel/carousel/pinned/planlanmış rozetleri, boş durumlar ve footer istatistiği. **Önizleme teması:** açık/koyu geçiş `localStorage` ile kalıcı (`dijivo-ig-preview-theme`); koyu moda text/border/icon/background restili (`src/lib/ig-preview-theme.ts`, `useInstagramPreviewTheme`). **Toplu kopyalama (§18):** medya panelinde tekli/çoklu seçim modu (`Çoklu seçim` düğmesi, DnD'yi bozmayan ayrı mod; seçim çubuğu: Temizle + Kopyala), `BulkCopyDialog` (marka › proje hedefi + seçenekler; hataları `N kopyalanamadı (ilk hata)` biçiminde raporlar; proje değişince seçim sıfırlanır). **Paylaşım düzeltmesi:** share snapshot'ı uygulama istatistiklerini (1234 vb.) taşıyor — app 1234 → share 1234 regresyon testi `src/lib/share-client.test.ts`'de sabitlendi. **Yeni dosyalar:** `src/lib/brand-ops.ts` (+21 test), `src/lib/ig-preview-theme.ts` (+3), `src/lib/plan-stats.ts` (+4), `src/lib/share-client.test.ts` (+2), `src/components/{BrandForm,BulkCopyDialog,MiniGridPreview,NewBrandModal,Onboarding,PostModal}.tsx`. **Değiştirilen:** `src/lib/{types,storage,post-ops,project-ops}.ts` (+testler), `src/hooks/use-persisted-grid.ts`, `src/components/{AppTopbar,AppSidebar,BrandEditor,BrandProfilePage,DashboardOverview,ExistingPostList,GridManager,GridPreview,MonthlyProjects,PlannedPostSorter}.tsx`, `src/app/share/[token]/page.tsx`; `PostInspector.tsx` ve `src/data/sample-data.ts` kaldırıldı. **Testler ve sonuçları:** `NODE_OPTIONS=--max-old-space-size=6144 npx vitest run` **146/146 PASS** (15 dosya); `npx tsc --noEmit` 0 hata; `npm run build` başarılı (dev sunucusu build sırasında kapalıydı). **Gerçek tarayıcı regresyonu (önceki oturum, Chromium):** PostModal ve GridPreview tarayıcıda doğrulandı; paylaşım akışı app→share 1234 doğrulandı. **Bilinen riskler:** Aylık plan kopyasında görsel Blob referansları ortak kullanılır (aktif proje silinmediği sürece güvenli); revoke endpoint'i capability-token modelindedir (auth/owner yok); çok sayfalı JPG'te ~10+ sayfada tarayıcı tuval sınırı riski; production deployment henüz yapılmadı. **Sonraki somut adım:** Production deployment smoke testi ve paylaşım linki saklama politikasını ürün sahibiyle netleştirme.

\- **Brand Selection Hub fazı (2026-10-01, `feature/brand-selection-hub`):** Uygulama girişindeki marka seçme deneyimi tamamlandı; mevcut onboarding, BrandWorkspace, marka oluşturma, izolasyon, topbar seçici, aylık planlar, grid planner, share/export ve persistence davranışları korundu. **Açılış yönlendirmesi (§1):** `resolveLaunchTarget(brandCount)` — 0 marka → onboarding, 1 marka → doğrudan dashboard (arasında seçim ekranı yok), 2+ marka → Marka Seçimi ekranı; `GridManager` bunu yalnızca ilk açılışta bir kez uygular (`launchDecidedRef`); son kullanılan markaya otomatik atlama yok (§9). Yeni Next.js route açılmadı; `AppView` birleşimine `"brands"` eklendi, mevcut route/share API değişmedi. **Yeni bileşen `src/components/BrandHub.tsx`:** "Markanızı seçin" başlığı + "Çalışmak istediğiniz markayı seçin veya yeni bir marka oluşturun." alt metni; kartlar `computeBrandCardStats(brandId, allProjects)` ile gerçek state'ten hesaplanır — profil fotoğrafı (yok ise ilk harf avatarı), marka adı + aktif "Aktif" rozeti, @username, aylık plan sayısı, aktif/son plan adı, içerik sayısı (mevcut+planlanan), `formatBrandActivity` ile son güncelleme (Bugün/Dün/N gün önce/tr-TR tarih); kart başına yalnızca "Markayı Aç" (primary) + "Profili Düzenle" (secondary); "+ Yeni Marka" dashed kartı mevcut `NewBrandModal`/`BrandForm` akışını yeniden kullanır (yeni marka otomatik aktif olur ve dashboard'a geçilir); 0-marka boş durumuna dayanıklı ("Henüz marka oluşturulmadı."); responsive `grid-cols-1 md:grid-cols-2 xl:grid-cols-3`. **Bağlam izolasyonu (§11):** hub'de `activeBrandId` yalnızca "Markayı Aç" aksiyonunda değişir; `handleOpenBrand` = `selectBrand(id)` (markanın en son güncellenmiş projesini seçer — başka markanın projesi asla seçilmez) + `setSelectedPostId(null)` + `setView('overview')`. **Sidebar (§5):** "Markalar" (`IdentificationIcon`) en üste eklendi — sıra: Markalar, Genel Bakış, Aylık Planlar, Grid Planner, Marka Profili, Paylaşım, Dışa Aktarma, Ayarlar; hangi bölümdeyse kullanıcı "Markalar"a basıp hub'e döner. **Topbar (§6):** hızlı marka/plan seçici KALDI — iki giriş noktası bir arada (hızlı geçiş vs genel yönetim). **Profil düzenleme (§8):** hub'tan açılan sabit dialog (`role=dialog aria-modal`, X/backdrop kapanma) `BrandEditor`ı `updateBrand(id, next)` ile canlı günceller; `updateBrandState` kayıt defterindeki markayı + o markanın TÜM proje aynalarını günceller, aktif marka düzenlenirse üst düzey ayna da senkronize olur. **Yeni API:** `src/lib/brand-ops.ts` — `LaunchTarget`/`resolveLaunchTarget`, `BrandCardStats`/`computeBrandCardStats`, `formatBrandActivity`, `updateBrandState`; `use-persisted-grid` — `updateBrand(id, next)` (`setBrand` buna delege eder; blob görsel kalıcılığı ve image lifecycle cleanup korunur). **Testler (§15):** `src/lib/brand-ops.test.ts` +13 yeni test (açılış hedefi 0/1/2+; kart istatistikleri; son güncelleme metni; profil düzenleme bağlamı) — toplam `NODE_OPTIONS=--max-old-space-size=6144 npx vitest run` **159/159 PASS** (15 dosya); `npx tsc --noEmit` 0 hata; `npm run build` başarılı (`/`, `/_not-found`, `/api/shares`, `/api/shares/[token]`, `/share/[token]`). **Gerçek tarayıcı smoke (Chromium, production build `next start`):** fresh storage (localStorage + IndexedDB silindi) → onboarding (0 marka) → Dijivo oluşturuldu → doğrudan dashboard (1 marka) → topbar "+ Yeni Marka" ile X Markası oluşturuldu (otomatik aktif + dashboard) → F5 → Marka Seçimi ekranı (2 kart + "Aktif" rozeti X Markası'nda) → Dijivo "Markayı Aç" → dashboard (activeBrandId=Dijivo, Ekim 2026) → sidebar "Markalar" → hub açıldı ama `activeBrandId` Dijivo'da kaldı (§11 doğrulandı) → X Markası "Markayı Aç" → dashboard (X Markası) → topbar hızlı geçiş X→Dijivo (native select değer atama workaround'ı) → plan seçici yalnızca Dijivo'nun Ekim 2026 planını gösterdi (strict izolasyon) → F5 → tekrar Marka Seçimi ekranı. **Responsive (17.):** 1440×900 ve 1366×768 → 3 kolon; 1024×768 ve 768×1024 → 2 kolon; 390×844 → 1 kolon; tüm viewport'larda yatay taşma 0px, kart içi taşma yok. **Regresyon spot-check:** Grid Planner (içerik paneli, "3 sütun" Instagram önizlemesi, boş durumlar, Öne Çıkanları Düzenle), Marka Profili (alt sekmeler), dashboard istatistikleri — çalışıyor. **Console/network:** hata yok, başarısız istek yok. **Bilinen riskler:** §10 "bir dahaki açılışta bu markayla başla" bilinçli eklenmedi (§9 varsayılanı: 2+ marka her açılışta seçim ekranı); önceki fazlardan devam eden riskler (revoke capability-token, çok sayfalı JPG tuval sınırı, aylık kopyada ortak Blob referansları) değişmedi. **Sonraki somut adım:** Production deployment smoke testi; gerekirse §10 kullanıcı tercihi eklenebilir.

\- **Reel video + etkileşimli paylaşım önizleme fazı (2026-10-02, `feature/share-interactive-preview`):** Mevcut/planlanan içeriklere reel (video) desteği ve paylaşım linki içinde oynatılabilir video eklendi; grid/pinned/export/multi-brand algoritmaları ve mevcut testler değişmedi. **Reel veri modeli:** `Post` üzerindeki `mediaType?: "image" | "video"`, `videoUrl?`, `coverImageUrl?` alanları (geriye dönük uyumlu); reel hücresi grid'de kapak görselini (`coverImageUrl` varsa, yoksa video referansını) gösterir ve `PlayIcon` rozetiyle işaretlenir; `POST`/`REELS` sekmeleri sayısını günceller. **Reel yükleme:** `ExistingPostList`'te "Reel" türü seçildiğinde önce kapak görseli (JPG/PNG/WebP, 10 MB) sonra video (MP4/WebM, 100 MB) yüklenir; `validators.ts` `validateVideoFile` — `looksLikeMp4` (byte 4-7 `ftyp`) ve `looksLikeWebm` (EBML header `1A 45 DF A3`) magic-byte doğrulaması, Türkçe mesajlar. **Video kalıcılığı:** `src/lib/video-store.ts` — IndexedDB (`dijivo-video-store`/`videos`) Blob deposu, `idb-video:<id>` referansları; `use-persisted-grid.ts` `hydrateState` içinde `idb:` görsel ve `idb-video:` video referanslarını tek haritada çözer; video/kapak referansı çözülemeyen reel ilgili alanları temizler (görseli çözülemeyen gönderi listeden düşer); `persistVideoUpload`, `resetToDefaults` `clearStoredVideos()` çağırır. **Paylaşım snapshot'ı:** `ShareSnapshot` post'larında `mediaType`/`videoUrl`/`coverImageUrl` taşınır; `isShareableVideoUrl` `blob:`/`idb:`/`idb-video:` reddeder, `storage:media/` kabul eder; video `MAX_SHARE_TOTAL_VIDEO_BYTES` (100 MB) ve toplam `MAX_SHARE_TOTAL_BYTES` ayrı kontrol edilir (erken 413). **Production video storage:** `supabase/migrations/202610010002_create_share_media_bucket.sql` — private `share-media` bucket'ı (yalnızca `video/mp4` + `video/webm` MIME, 100 MB); `SupabaseShareStore` video snapshot'larını `storage:media/<path>` olarak bu bucket'a yükler, share sayfasında server-side 3600 sn signed URL'e resolver. **Salt-okunur share modalı:** `src/components/SharePostModal.tsx` — paylaşım sayfasında gönderiye tıklayınca açılır; `<video controls playsInline preload="metadata">` (autoplay yok), kapanınca `pause()` + `currentTime=0`, Escape ile kapanma; avatar/@username/caption (hashtag renklendirme), carousel/reel rozeti, `useInstagramPreviewTheme`; düzenleme butonu yok (salt-okunur). **Revoke:** `/api/shares/[token]` DELETE + `SharePanel` "Bağlantıyı kaldır" — link kaldırıldıktan sonra `/share/[token]` "Paylaşım kullanılamıyor" ekranına düşer. **Cross-brand kopya:** `copyPostToProjectState` reel'in `mediaType`/`videoUrl`/`coverImageUrl` alanlarını yeni kimlikle taşır; aynı `idb-video:` referansı paylaşılır (kaynak silinse de hedefin videosu çözülür). **Testler ve sonuçları:** `npx tsc --noEmit` 0 hata; `npx vitest run` **198/198 PASS** (16 dosya); `npm run build` başarılı (`/`, `/_not-found`, `/api/shares`, `/api/shares/[token]`, `/share/[token]`; build öncesi dev sunucusu durduruldu, build sonrası port 3100'de yeniden başlatıldı). **Gerçek tarayıcı doğrulaması (Chromium, dev):** reel yükleme + F5 kalıcılığı (kapak `blob:` URL'den yüklenir, kırık yok); paylaşım linki oluşturma (POST /api/shares 201) → share sayfasında reel videosu `share-media` signed URL'den oynar (readyState=4, 1.58s, controls, autoplay yok, düzenleme butonu yok, playback ilerler); revoke → "Paylaşım bağlantısı kaldırıldı." + ölü link ekranı; 4 boyut responsive (1440/1024/768/390) taşma yok; konsol/network temiz (share-media 206 Media); DnD klavye sıralaması (Space+ok+Space, liste ve grid güncellendi); cross-brand reel kopya (REELS sayacı + video referansı korundu, kopyanın videosu aynı `idb-video:` referansından çözülür); carousel yükleme regression'u (2 görsel → 2 planlanan carousel post, `postType` korundu, grid POST sayısı güncellendi). **Bilinen limitler:** ffmpeg yok — gerçek oynatılabilir video tarayıcıda `canvas.captureStream`+`MediaRecorder` WebM ile üretilir; revoke endpoint capability-token modelindedir (auth/owner yok); arka plan sekmesinde canvas-origin WebM'in `currentTime` ilerlemesi throttlenebilir (metaveri yüklenir, play() çözülür). **Sonraki somut adım:** Production deployment smoke testi.

- **İçerik Takvimi / Planlama / Bildirim fazı (2026-10-02, `feature/calendar-planning-notifications`):** Aylık plan içine zaman boyutlu içerik takvimi, gün detayı, checklist, hatırlatma teslimatı ve dashboard takvim kartları eklendi. Uygulama "Social Media Content Planning & Tracking Panel" yönüne doğru genişledi; mevcut grid/pinned/export/share/multi-brand davranışları korundu (273/273 test PASS). **Veri modeli (`src/lib/calendar-types.ts`):** `CalendarItem` — `id`, `brandId`, `projectId`, `postId?`, `itemType` (`post|reel|story|note|task`), `title`, `description`, `scheduledAt` (ISO), `status` (`draft|planned|published|cancelled`), `reminderOffsetMinutes?`, `checklist[]` (`id/label/done`), `createdAt/updatedAt`; ayrıca `ReminderDelivery` (`itemId/brandId/channel/remindAt/scheduledAt/title/body/deliveredAt/readAt`) ve `ChecklistItem`. **Saf mantık:** `src/lib/calendar-utils.ts` (+29 test) — `buildMonthMatrix`, `startOfWeek`, `itemsForDay`, `filterByProject`, `computeDraggedScheduledAt`, `toggleChecklistItem`, `reminderAt`, `deriveStatus`, `formatTime/formatDayLong`, `isToday/isPastDay/isWeekend`; `src/lib/calendar-link.ts` (+10 test) — `buildLinkedPostOptions` ve `resolveCalendarLink` (post başka marka/projede ise veya silinmişse `status: "unresolved"` reddi); `src/lib/calendar-store.ts` (+14 test) — `LocalCalendarStore` (localStorage `dijivo-calendar-items` / `dijivo-calendar-deliveries`), `validateCalendarInput`, `createChecklistItem`. **Depo soyutlaması:** `CalendarStore` arayüzü; iki uygulama — `SupabaseCalendarStore` (`src/lib/supabase-calendar-store.ts`) ve `LocalCalendarStore`; tarayıcı arayüzü `src/lib/api-calendar-store.ts`. **API (Next route handler):** `/api/calendar/config`, `/api/calendar/items` (+`[id]`), `/api/calendar/brand-items`, `/api/calendar/deliveries` (+`[id]`, `mark-all-read`) ve sunucu deposu `src/app/api/calendar/_store.ts`. **Migration:** `supabase/migrations/202610020003_create_calendar_tables.sql` — `calendar_items` + `calendar_deliveries` tabloları, `item_id|remind_at` UNIQUE kısıtı (tekrar teslim engeli), `brand_id`/`project_id` indeksleri ve RLS. **Config probe (kritik ortam kararı):** `/api/calendar/config` yalnızca Supabase erişimini değil, `calendar_items` tablosunun varlığını da 4 sn timeout'lu `listItems('','')` probu ile doğrular; tablo yoksa/erişilemiyorsa `{supabase:false}` döner ve istemci `use-calendar-store` `LocalCalendarStore`'a düşer — production persistence yoksa uygulama sessizce bozulmaz, local dev her zaman çalışır. **Yeni bileşenler `src/components/calendar/`:** `CalendarView` (kontroller, Ay/Hafta/Gün sekmeleri, DndContext, drawer + form sahipliği; `visibleItems = filterByProject(brandItems, brandId, displayedProject.id)` ile proje izolasyonu; görünen aya plan yoksa boş durum + "Aylık Plan Oluştur", asla otomatik proje üretilmez), `MonthView` (Pzt–Paz grid, max 3 kart + "+N içerik", `role=grid/row/gridcell`, `animate-calendar-enter`), `WeekView` (7 gün × 08:00–23:00 saat satırı), `DayView` (tek gün saat şeridi), `DayDetailDrawer` (`+ İçerik Ekle` / `+ Not Ekle` / `+ Görev Ekle`, checklist toggle, Düzenle/Sil, bağlı kayıtta "Grid Planner'da Aç"), `PlanningForm` (tür seçimi Post/Reel/Story/Not/Görev, "Yeni içerik" vs "Mevcut içeriği bağla", başlık/açıklama/tarih/saat/durum/hatırlatma [15dk/1sa/1gün/2gün/Özel]/checklist; odak tuzağı + Escape), `CalendarItemCard` (sürüklebilir kart), `StatusBadge`, `NotificationCenter` (okunmamı rozeti, "Tümünü okundu işaretle", tarayıcı bildirimi izni). **Entegrasyon:** `AppView`'a `"calendar"`; sidebar'a `Takvim` (`CalendarDaysIcon`, Aylık Planlar ile Grid Planner arasında); `GridManager.openProject` artık `setView("calendar")` ile takvimi açıyor (§2 "Planı Aç" → Takvim); `handleOpenItemInPlanner` `resolveCalendarLink` ile doğrulanıp `planner` görünümünde ilgili postu seçiyor; `handleOpenPlanner` araç çubuğu "Grid Planner'da Aç"; `DashboardOverview` "BUGÜNKÜ PLAN" (toplam/planlanan/yayınlanan/gecikmiş + "Bir sonraki") ve "YAKLAŞANLAR" (önümüzdeki 7 gün) kartları. **Hatırlatma teslimatı (`use-calendar-store.ts`):** `REMINDER_POLL_MS=15_000`, `REMINDER_LATE_WINDOW_MS=12h`; `deliveredKeysRef` + depodaki teslimatlar ile `itemId|remindAt` anahtarı üzerinden **once-only**; teslimat sonrası in-app bildirim + `showBrowserNotification` (izin varsa) + `onReminder` callback. **Bu turda düzeltilen iki hata:** (1) `PlanningForm` başarılı kayıtta formu kapatmıyordu → `onSubmit` true dönerse `onClose()`; (2) form kapanmadığı için "Görev Ekle" kısayolu eski state'i yeniden kullanıp `task` yerine `note` üretiyordu → her açılışta temiz `defaultItemType`. **Testler:** `calendar-utils` 29, `calendar-store` 14, `calendar-link` 10 yeni test → toplam `npx vitest run --no-isolate --reporter=basic` **273/273 PASS** (22 dosya); `node --max-old-space-size=3072 node_modules/typescript/bin/tsc --noEmit` 0 hata; `npm run build` başarılı (12 route). **Gerçek tarayıcı doğrulaması (Chromium, production build `next start`):** Marka aç → Aylık Planlar → "Planı Aç" → Takvim; Ay/Hafta/Gün görünümleri; 15 Ekim'e Reel + saat 18:30 + "1 saat önce" hatırlatma + 2 checklist öğesi kaydedildi; ay görünümünde 15→16 Ekim'e **sürükle-bırak** tarih değiştirdi (saat korundu); F5 sonrası kayıt korundu; checklist toggle kalıcı; Not ve Görev eklendi; "Mevcut içeriği bağla" ile Grid Planner içeriği takvim kaydına bağlandı (başlık otomatik doldu) ve kaydın "Grid Planner'da Aç" aksiyonu doğru postun editörünü açtı; marka izolasyonu (X Markası takvimi boş) ve proje izolasyonu (Kasım planı Ekim kayıtlarını göstermiyor) doğrulandı; hatırlatma teslimatı canlı tetiklendi (`remind_at` geçmişe düştü, 12 saatlik geç yakalama penceresi) ve F5 sonrası **tekrar teslim edilmedi** (deliveries = 1); bildirim merkezi okunmamı rozeti + "Tümünü okundu" + tarayıcı bildirimi izni butonu; dashboard "Bugünkü Plan"/"Yaklaşanlar" dolu; responsive 390×844'te 0 yatay taşma. **Regresyon spot-check (hepsi PASS):** çoklu görsel yükleme (2 ve 3 dosya), pin (1/3), planlı gönderi **DnD sıralama** (plan1 1.→3.), Reel yükleme + IndexedDB video kalıcılığı (`dijivo-video-store`, 2226 bayt WebM, F5 sonrası), paylaşım linki oluşturma (POST 201) + salt-okunur share sayfası (düzenleme/sil/yükleme kontrolü yok), PDF (`dijivo.pdf`) ve JPG (`dijivo.jpg`) indirme, F5 sonrası 5 içerik korundu. Console 0 hata, network'te başarısız istek yok. **Bilinen limit / blocker:** `supabase/migrations/202610020003_create_calendar_tables.sql` **bu ortamda uygulanmadı** — Supabase projesi erişilebilir (~170 ms) ancak `calendar_items` tablosu yok (`PGRST205 Could not find the table 'public.calendar_items' in the schema cache`); migration bu makineden uygulanamıyor (DB parolası yok, service-role JWT DDL yetkisine sahip değil). `/api/calendar/config` bu yüzden `{supabase:false}` döner ve tüm takvim verisi **localStorage fallback** ile tutulur — production persistence tamamlanmış sayılmaz. Ayrıca hatırlatma teslimatı yalnızca uygulama açıkken çalışır (arka plan sekmesi kapalıyken servis worker/periodic sync yok) ve e-posta kanalı uygulanmamıştır (yalnızca `in_app` + isteğe bağlı tarayıcı bildirimi). **Sonraki somut adım:** Supabase SQL Editor'da migration'ı çalıştırıp `/api/calendar/config` çıktısının `{supabase:true}` olduğunu doğrulamak; ardından servis worker tabanlı arka plan teslimatı ve e-posta transport'u.

- **Faz 2 — Share pipeline + Supabase migration + gerçek background notification (2026-10-07, `feature/calendar-planning-notifications`, base `9339a30`):** Üç production blocker çözüldü; çalışan takvim/planning/DnD/not/görev/checklist/grid link/bildirim merkezi/dashboard/local fallback özellikleri değiştirilmedi (regresyon yok). **Share fix (kök neden):** coverless Reel'in `imageUrl`'ı aslında video blob'uydu (`idb-video:`); eski `imageUrlForShare` `video/webm`'i image path'e fetch edip "Yüklenen görsel paylaşım için desteklenmiyor" hatası üretiyordu. `src/lib/share-media.ts` (kaynak sınıflandırma + magic-byte doğrulama) ve yeniden yazılan `src/lib/share-client.ts` (enjekte edilebilir reader/posterMaker) ile akış: `idb:`/`idb-video:` → IndexedDB Blob/File resolve → Supabase private storage upload (`share-images` görsel, `share-media` video) → snapshot içinde yalnızca `storage:` referansları (`idb:`/`idb-video:`/`blob:` asla kalıcılmaz). `src/lib/supabase-share-store.ts`'e hücre-içi (per-cell) data-URL dedupe eklendi — Reel hücresi aynı kapağı `imageUrl` + `coverImageUrl` ile taşıdığı için tek cache paylaşımı mevcut testleri kırıyordu (4/5 upload beklentisi), per-cell kapsamla 334/334'e döndü. **Gerçek tarayıcı doğrulaması (Reel SİLİNMEDİ):** Grid Planner'dan gerçek 3 dosyalı multi-image upload (PNG+JPG+WebP, `input[type=file]` DataTransfer), gerçek WebM Reel (87 KB, `canvas.captureStream`+`MediaRecorder`) ve gerçek **MP4** Reel (102 KB, `MediaRecorder.isTypeSupported('video/mp4')===true`) + JPEG kapak → POST `/api/shares` **201**. Incognito (IndexedDB yok) salt-okunur: 10/10 görsel Supabase signed URL'den yüklendi, REELS sekmesi 2, coverless Reel videosu signed `share-media` URL'den (readyState 4, 480×480) **tam süresi boyunca oynadı** (0 → 1.742s, hata yok); HTML'de `idb:`/`idb-video:`/`blob:` taraması boş; console 0 hata, tüm istekler 200/206. Revoke (31e96521): "Paylaşım bağlantısı kaldırıldı." → incognito'da "Paylaşım kullanılamıyor". TTL: `expires_at` geçmişe çekilince sayfa "Paylaşım kullanılamıyor" gösterdi (sonra +30 güne geri alındı); snapshot `createdAt` 2026-10-07 / `expires_at` 2026-11-06 (SHARE_TTL_DAYS=30). **Supabase migration:** `supabase/migrations/202610020003_create_calendar_tables.sql` yeniden yazıldı (idempotent: `create table if not exists`, `drop function if exists`, string post ID formatı ile uyumlu, FK'lar + indeksler + `updated_at` trigger + RLS modeli audit edildi); `202610020004_schedule_reminder_dispatch.sql` (pg_cron `reminder-dispatch` Edge Function çağrısı) ve `supabase/functions/reminder-dispatch/index.ts` (Deno, tsconfig dışı) eklendi; `SUPABASE-KURULUM.md` runbook (SQL Editor'de hangi dosyanın çalıştırılacağı, Edge Function deploy, VAPID, cron). **Tablo probu (canlı):** `share_snapshots` VAR; `calendar_items`, `reminder_deliveries`, `notification_deliveries`, `push_subscriptions` YOK (PGRST205). `/api/calendar/config` → `{"supabase":false}` dönmeye devam ediyor (doğru davranış; kod bypass'ı yok, local fallback korundu). **Gerçek background notification mimarisi:** Edge Function + pg_cron tercih edildi (açık sekme polling'i "tamam" sayılmadı); worker SQL'i `remind_at <= now() AND delivered` idempotent sorgusu + delivery kaydı ile **once-only** tek teslimat sağlar; `push_subscriptions` tablosu migration içinde; `POST /api/push/subscriptions` canlı CURL ile doğrulandı (eksik `brandId` → 400, `http://` endpoint → 422, eksik keys → 422, geçerli payload → 502 çünkü tablo henüz yok — beklenen migration blocker'ı). **Service worker:** `public/sw.js` artık gerçek worker — `push` olayı JSON payload'da `tag: dijivo-<itemId>` + `renotify` (aynı tag tekrar gelirse dedupe), non-JSON fallback `event.data.text()`; `notificationclick` mevcut client'ı focus+navigate eder, yoksa `openWindow` ile derin link `/?view=calendar&brand=...&date=...&item=...` (test worker derin linki `notificationTargetUrl()` ile birebir aynı); ikonlar `/icon.svg` (önceki `/icon-192.png` 404'tü); yeni `src/app/icon.svg` favicon 404'ü de kaldırdı. **VAPID güvenliği:** private key `NEXT_PUBLIC_*` değil; `.env.example` yalnız placeholder. **Kanal mimarisi:** `in_app` + `browser_push` + `email` (email bu fazda gönderilmiyor, arayüz hazır). **Testler:** yeni `share-media.test.ts` (13), `share-media-pipeline.test.ts` (7, idb→upload uçtan uca), `service-worker.test.ts` (7, gerçek `public/sw.js` `new Function('self', src)` ile yüklenir), `reminder-dispatch.test.ts` (22, idempotency + due sorgusu), `calendar-backend.test.ts`, `share-client.test.ts` genişletildi → `npx vitest run --no-isolate --reporter=basic` **341/341 PASS** (27 dosya); `tsc --noEmit` 0 hata; `npm run build` başarılı. **Canlı browser kanıtı:** yeni kayıt → F5 → 11 planlama kalıcı; marka izolasyonu (X Markası 0 / Dijivo 11 planlama); bildirim merkezi (in-app hatırlatma listesi + izin butonu "Tarayıcı bildirimi engellendi" — profil seviyesi redd, önceden mevcut); SW aktif (`scope http://localhost:3000/`, `pushSupported: true`); console 0 hata. **Blocker (açık):** migration bu ortamdan uygulanamadı (DB parolası yok, service-role JWT DDL yetkisiz) — `calendar_items`/delivery/push tabloları yok, Edge Function + pg_cron deploy edilemedi (Supabase CLI login yok), browser push izni test profilinde `denied`. Production source of truth Supabase olana kadar takvim verisi localStorage fallback'te. **Sonraki somut adım:** `SUPABASE-KURULUM.md` adımlarını Supabase SQL Editor'de çalıştır → `/api/calendar/config` `{"supabase":true}` → Edge Function deploy + cron.
## 13. Karar Kaydı

| Tarih | Karar | Gerekçe | Etki |

| --- | --- | --- | --- |

| 2026-09-25 | RADAAR yerine özel grid preview aracı | RADAAR takvim ve tekil önizleme sunuyor; gerekli toplu profil grid sunumu, pin mantığı, Dijivo A4/JPG çıktısı ve paylaşım ihtiyacını karşılamıyor. | MVP özel araç olarak geliştirilecek. |

| 2026-09-25 | MVP, manuel içerik ekleme ile başlayacak | En kısa sürede değer üretmek ve Meta entegrasyonunu kapsam dışı tutmak. | Instagram API bağlantısı Faz 2. |

| 2026-09-25 | PDF/JPG export mimarisi: Browser Canvas → aynı `renderExportPage` yüzeyi → JPG binary ve pdf-lib ile A4 PDF | Tek render kodu iki formatı da besler; PDF ve JPG aynı marka, grid sırası, pinned/planlanan durumu ve kırmayı garanti eder. `pdf-lib` tarayıcıda çalışır ve gerçek `%PDF-` üretir; JPG `canvas.toBlob` ile gerçek binary olur. Node-only API (fs/Buffer) kullanılmaz. | Export mimarisi sabitlendi; `pdf-lib` dependency projede kullanımda kaldı. |

| 2026-09-25 | Export görselleri `crossOrigin="anonymous"` ile yüklenir | Tarayıcıda CORS'suz cross-origin görsel canvas'i kirletir → `toBlob` SecurityError verir; placehold.co `ACAO:*` destekler. | Export görsel hataları artık satır içi mesajla görünür; bloklayan `alert()` kaldırıldı. |

| 2026-09-25 | Kalıcılık mimarisi: IndexedDB (görsel Blob'ları) + localStorage (küçük JSON metaveri), şema sürümü `STORAGE_VERSION=1`, `idb:<id>` referansları | Yüklenen görsel dosyaların yenilemede yaşaması için binary kalıcı depo gerekir; IndexedDB tarayıcı yerlisidir ve yeni bağımlılık eklemez. localStorage küçük metaveri için yeterlidir ama `blob:` object URL kabul edemez (yenilemede ölür) — bu yüzden state'teki `blob:` URL'ler yazılırken `idb:` referansına çevrilir (`toPersistableState`), haritada olmayan `blob:` hiç yazılmaz. Sürüm damgası bozuk/gelecek veriyi bilinçli olarak reddeder → demo varsayılanlarına düşülür. | `pdf-lib` gibi yeni dependency eklenmedi; kalıcılık mantığı `GridManager` dışında (`storage.ts`, `image-store.ts`, `use-persisted-grid.ts`). Sıfırlama localStorage + IndexedDB'yi temizler. |

| 2026-09-25 | Boş gridde export üretilmez | Boş gridden blank PDF/JPG kullanıcıya değersizdir. | `getExportAvailability` ile butonlar `disabled` olur ve "Grid boş" açıklaması gösterilir. |

| 2026-09-25 | Salt-okunur paylaşım snapshot/token/storage kararı: UUID token'lı immutable `ShareSnapshot`, `ShareStore` adapter sözleşmesi ve geçici process-geneli `InMemoryShareStore` | Editör localStorage/IndexedDB verisi başka tarayıcıda paylaşılmaz; snapshot ayrı oluşturulup strict doğrulanmalıdır. Production database/backend olmadığı için kalıcı cross-device garanti verilemez. `blob:` görseller `data:` URL'e dönüştürülür; `idb:`/`blob:` referansları reddedilir. | `/api/shares` snapshot oluşturur, `/share/[token]` yalnızca okunur render eder. Gerçek dağıtım için shared DB + object storage/CDN adapter'ı, TTL/revocation ve çoklu-instance uyumu gerekir. |

| 2026-09-25 | Production share storage: `SupabaseShareStore` (Postgres + private Storage) | Memory store restart/deploy/multi-instance gereksinimlerini karşılamaz. Data upload'ları DB'ye yazılmadan private bucket'a taşınır; external HTTP(S) URL'ler SSRF riski nedeniyle server fetch edilmeden external ref kalır. | Payload `storage:<path>` saklar; renderda server-side 3600 sn signed URL üretilir. TTL 30 gün varsayılan, revoke `revoked_at` ile uygulanır; production için `SUPABASE_URL` ve `SUPABASE_SECRET_KEY` zorunludur. |

| 2026-10-01 | Açılış yönlendirmesi: 0 marka → onboarding, 1 marka → doğrudan dashboard, 2+ marka → Marka Seçimi ekranı (her açılışta); `lastOpenedBrandId`/otomatik atlama yok (§9); §10 "bir dahaki açılışta bu markayla başla" bu fazda eklenmedi | 2+ markada yanlış markanın dashboard'una otomatik girmek kullanıcıyı karıştırır; seçim ekranı her açılışta hangi markada çalışılacağını sorar. Tek Next.js route (`/`) ve mevcut route/share API korundu; `brands` yalnızca `AppView` state değeridir. | `resolveLaunchTarget` + `BrandHub` view (`src/components/BrandHub.tsx`); `GridManager` açılış kararı `launchDecidedRef` ile tek seferlik uygular. |

| 2026-10-02 | Reel video kalıcılığı + paylaşım videosu: `src/lib/video-store.ts` IndexedDB (`idb-video:` referansları) + private Supabase `share-media` bucket'ı (yalnızca `video/mp4`/`video/webm`, 100 MB) | Reel video'larının yenilemede yaşaması için binary kalıcı depo gerekir (görsellerde olduğu gibi); paylaşım linkinde oynatılabilir video için private bucket + server-side signed URL. `blob:`/`idb:`/`idb-video:` referansları paylaşım snapshot'ından reddedilir, video `storage:media/<path>` olarak taşınır. | Reel yükleme/kalıcılık/share modalı eklendi; `MAX_SHARE_TOTAL_VIDEO_BYTES` ayrı sınırı ve erken 413. |

| 2026-10-08 | Takvim bildirim/hatırlatma sisteminin tamamen kaldırılması | Bildirim sistemi gereksiz infrastructure (push, cron, Edge Function, deliveries) getiriyordu ve sadece saf planlama sistemi isteniyordu. | Geri kalan özellikler korundu; tsc 0 hata, 292/292 test PASS, build PASS. |

