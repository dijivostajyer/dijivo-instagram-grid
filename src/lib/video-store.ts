/**
 * Yüklenen reel videolarının Blob'larının kalıcı saklandığı
 * IndexedDB katmanı (Phase 2, §9).
 *
 * - Görsellerden (image-store.ts) AYRı bir veritabanı/object
 *   store kullanır; video yaşam döngüsü image lifecycle sistemiyle
 *   karışmaz.
 * - Metaveride `videoUrl` alanı, yüklenmiş bir video için
 *   `idb-video:<id>` biçiminde bir referans taşır.
 * - `blob:` object URL'leri kalıcı veriye asla yazılmaz
 *   (bkz. `storage.ts`).
 */

const DB_NAME = "dijivo-video-store";
const DB_VERSION = 1;
const STORE_NAME = "videos";

/** Metaveride saklanan video referanslarının ön eki. */
export const VIDEO_REF_PREFIX = "idb-video:";

/** Bir video kimliğinden metaveri referansı üretir. */
export function makeVideoRef(id: string): string {
  return VIDEO_REF_PREFIX + id;
}

/** Değerin IndexedDB video referansı olup olmadığını söyler. */
export function isVideoRef(value: string): boolean {
  return value.startsWith(VIDEO_REF_PREFIX);
}

/** `idb-video:<id>` → `<id>`; referans değilse `null`. */
export function videoRefId(value: string): string | null {
  if (!isVideoRef(value)) return null;
  const id = value.slice(VIDEO_REF_PREFIX.length);
  return id.length > 0 ? id : null;
}

/** Benzersiz video kimliği (tarayıcıda uuid, fallback ile test edilebilir). */
export function newVideoId(): string {
  const cryptoObj: Crypto | undefined =
    typeof globalThis !== "undefined" ? globalThis.crypto : undefined;
  if (cryptoObj && typeof cryptoObj.randomUUID === "function") {
    return cryptoObj.randomUUID();
  }
  return `vid-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function hasIndexedDb(): boolean {
  return typeof indexedDB !== "undefined" && indexedDB !== null;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!hasIndexedDb()) {
      reject(new Error("IndexedDB bu ortamda kullanılamıyor."));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("IndexedDB açılamadı."));
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    try {
      const tx = db.transaction(STORE_NAME, mode);
      const store = tx.objectStore(STORE_NAME);
      const request = run(store);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(request.error ?? new Error("IndexedDB işlemi başarısız."));
      tx.oncomplete = () => db.close();
      tx.onerror = () => {
        db.close();
        reject(tx.error ?? new Error("IndexedDB işlemi başarısız."));
      };
    } catch (error) {
      db.close();
      reject(error);
    }
  });
}

/**
 * Object URL'e çevrilmiş bir videonun Blob'ını IndexedDB'ye
 * yazar ve metaveride kullanılacak `idb-video:<id>` referansını
 * döndürür.
 */
export async function persistVideoObjectUrl(objectUrl: string): Promise<string> {
  const response = await fetch(objectUrl);
  if (!response.ok) {
    throw new Error("Yüklenen video okunamadı.");
  }
  const blob = await response.blob();
  const id = newVideoId();
  await withStore<IDBValidKey>("readwrite", (store) => store.put(blob, id));
  return makeVideoRef(id);
}

/**
 * `idb-video:<id>` referansını Blob'a çevirip yeni bir object
 * URL verir. Referans değilse veya Blob bulunamazsa `null` döner.
 */
export async function loadVideoAsObjectUrl(ref: string): Promise<string | null> {
  const id = videoRefId(ref);
  if (id === null) return null;
  try {
    const blob = await withStore<Blob | undefined>("readonly", (store) =>
      store.get(id),
    );
    if (!blob) return null;
    return URL.createObjectURL(blob);
  } catch {
    return null;
  }
}

/** Tek bir video referansını kalıcı depodan siler. */
export async function deleteStoredVideo(ref: string): Promise<void> {
  const id = videoRefId(ref);
  if (id === null) return;
  try {
    await withStore("readwrite", (store) => store.delete(id));
  } catch (error) {
    // Silinemese bile kullanıcı akışı devam eder.
    console.warn("[persistence] Kalıcı video silinemedi:", error);
  }
}

/** Sıfırlama: depodaki tüm videoları siler. */
export async function clearStoredVideos(): Promise<void> {
  try {
    await withStore("readwrite", (store) => store.clear());
  } catch (error) {
    // Depo yoksa/silinemiyorsa reset akışı yine devam eder.
    console.warn("[persistence] Kalıcı videolar temizlenemedi:", error);
  }
}
