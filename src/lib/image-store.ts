/**
 * Yüklenen görsellerin Blob'larının kalıcı saklandığı IndexedDB katmanı
 * (MVP aşama 4).
 *
 * - Metaveride `imageUrl`/`profileImageUrl` alanları, yüklenmiş bir görsel
 *   için `idb:<id>` biçiminde bir referans taşır.
 * - Blob'lar IndexedDB'de (`dijivo-image-store` / `images`) saklanır; açılışta
 *   referanslar yeniden `URL.createObjectURL` ile çözülür.
 * - `blob:` object URL'leri kalıcı veriye asla yazılmaz (bkz. `storage.ts`).
 */

const DB_NAME = "dijivo-image-store";
const DB_VERSION = 1;
const STORE_NAME = "images";

/** Metaveride saklanan görsel referanslarının ön eki. */
export const IMAGE_REF_PREFIX = "idb:";

/** Bir görsel kimliğinden metaveri referansı üretir. */
export function makeImageRef(id: string): string {
  return IMAGE_REF_PREFIX + id;
}

/** Değerin IndexedDB görsel referansı olup olmadığını söyler. */
export function isImageRef(value: string): boolean {
  return value.startsWith(IMAGE_REF_PREFIX);
}

/** `idb:<id>` → `<id>`; referans değilse `null`. */
export function imageRefId(value: string): string | null {
  if (!isImageRef(value)) return null;
  const id = value.slice(IMAGE_REF_PREFIX.length);
  return id.length > 0 ? id : null;
}

/** Benzersiz görsel kimliği (tarayıcıda uuid, fallback ile test edilebilir). */
export function newImageId(): string {
  const cryptoObj: Crypto | undefined =
    typeof globalThis !== "undefined" ? globalThis.crypto : undefined;
  if (cryptoObj && typeof cryptoObj.randomUUID === "function") {
    return cryptoObj.randomUUID();
  }
  return `img-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
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
 * Object URL'e çevrilmiş bir dosyanın Blob'ını IndexedDB'ye yazar ve
 * metaveride kullanılacak `idb:<id>` referansını döndürür.
 */
export async function persistObjectUrl(objectUrl: string): Promise<string> {
  const response = await fetch(objectUrl);
  if (!response.ok) {
    throw new Error("Yüklenen görsel okunamadı.");
  }
  const blob = await response.blob();
  const id = newImageId();
  await withStore<IDBValidKey>("readwrite", (store) => store.put(blob, id));
  return makeImageRef(id);
}

/**
 * `idb:<id>` referansını Blob'a çevirip yeni bir object URL verir.
 * Referans değilse veya Blob bulunamazsa `null` döner.
 */
export async function loadImageAsObjectUrl(ref: string): Promise<string | null> {
  const id = imageRefId(ref);
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

/** Tek bir görsel referansını kalıcı depodan siler. */
export async function deleteStoredImage(ref: string): Promise<void> {
  const id = imageRefId(ref);
  if (id === null) return;
  try {
    await withStore("readwrite", (store) => store.delete(id));
  } catch {
    // silinemese bile sıfırlama akışı devam eder
  }
}

/** Sıfırlama: depodaki tüm görselleri siler. */
export async function clearStoredImages(): Promise<void> {
  try {
    await withStore("readwrite", (store) => store.clear());
  } catch {
    // depo yoksa temizlenecek bir şey de yok
  }
}
