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



\- \*\*Son güncelleme:\*\* 2026-09-25 (production Supabase share storage)

\- \*\*Güncelleyen:\*\* Codex (AI) — production Supabase share storage

\- \*\*Aktif iş:\*\* Production share storage tamamlandı: Supabase Postgres + private Storage adapter'ı, TTL, revoke ve signed URL çözümü hazır. Sonraki iş: gerçek Supabase project credential'larıyla deployment smoke testi ve operasyonel revoke arayüzü.

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

\- \*\*Değiştirilen dosyalar:\*\* Aşama 2: `package.json`, `package-lock.json` (@dnd-kit/core, @dnd-kit/sortable, @dnd-kit/utilities eklendi), `src/lib/validators.ts`, `src/lib/validators.test.ts`, `src/lib/post-ops.ts`, `src/lib/post-ops.test.ts`, `src/components/BrandEditor.tsx`, `src/components/ExistingPostList.tsx`, `src/components/PlannedPostSorter.tsx`, `src/components/GridManager.tsx`, `src/components/GridPreview.tsx`, `src/app/page.tsx`, `AI-HANDOFF.md`. Önceki aşamadan: `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`, `vitest.config.ts`, `.gitignore`, `src/lib/types.ts`, `src/lib/grid.ts`, `src/lib/grid.test.ts`, `src/app/layout.tsx`, `src/app/globals.css`, `src/data/sample-data.ts`. Aşama 3: `src/lib/export.ts`, `src/lib/export.test.ts`, `src/lib/order.test.ts`, `src/components/ExportPanel.tsx`, `src/components/GridManager.tsx`, `ai-handoff.md`, `.gitignore` (`dev.log` git index'inden çıkarıldı `git rm --cached`). Aşama 4: `src/lib/storage.ts`, `src/lib/storage.test.ts`, `src/lib/image-store.ts`, `src/hooks/use-persisted-grid.ts`, `src/lib/export.ts` (`getExportAvailability`), `src/lib/export.test.ts`, `src/components/GridManager.tsx`, `src/components/ExportPanel.tsx`, `ai-handoff.md`. Lifecycle cleanup: `src/lib/image-lifecycle.ts`, `src/lib/image-lifecycle.test.ts`, `src/lib/image-store.ts`, `src/hooks/use-persisted-grid.ts`, `src/components/BrandEditor.tsx`, `ai-handoff.md`.

\- \*\*Testler ve sonuçları:\*\* `npm run typecheck`: 0 hata. `npm test` (Vitest): **74/74 geçti** (önceki 69 + lifecycle cleanup 5). `npm run build`: başarılı. Lifecycle testleri HTTP demo görselinin IndexedDB'den silinmediğini, upload'ın doğru `idb:` referansını bulduğunu, silinen URL eşlemesinin çıkarıldığını/revoke edildiğini, aktif paylaşılan referansın korunmasını, reset/unmount revoke davranışını ve hata yalıtımını kapsar; mevcut persistence roundtrip/reset testleri de geçer. Tarayıcı smoke (bu güncelleme): demo grid yenileme sonrası geri geldi; PDF ve JPG İndir akışları hata göstermeden tamamlandı ve UI "Dosyalar indirildi" bildirimini gösterdi. Bu smoke sırasında yeni dosya yükleme, silme/profil değiştirme veya reset yapılmadı.

\- \*\*Bilinen engel/risk:\*\* Nihai Dijivo marka varlıkları ve paylaşım linki saklama politikası netleşmeli. Veri kalıcılığı4. aşama ile eklendi (localStorage metaveri + IndexedDB Blob'lar); eski "veri kalıcılığı yok" kısıtı geçersiz. dnd-kit SSR'da aria-describedby hydration uyarısı üretebilir; sürükleme tutamacında `suppressHydrationWarning` ile bastırıldı. Demo görselleri placehold.co'dan geldiği için çevrimdışı gösterimde yüklenmez. 3+ pinned gönderinin "normal akışa düşme" davranışı ürün sahibiyle teyit edilecek. Export riski: çok sayfalı JPG'te tuval yüksekliği `A4*2*pageCount` piksel olur; ~10+ sayfada tarayıcı tuval boyut sınırı aşılabilir (kısmi test edilmedi). Cross-origin görsel CORS desteklemiyorsa export görsel yükleme hatası verir (bilinçli, satır içi hata mesajı gösterilir).



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



\## 13. Karar Kaydı



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



