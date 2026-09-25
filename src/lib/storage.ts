import type { Brand, ExistingPost, PlannedPost } from "./types";

/**
 * Uygulama metaverisi kalıcılığı (MVP aşama 4).
 *
 * Mimari kararı (ai-handoff.md §13):
 * - Küçük JSON metaverisi (marka, gönderi listeleri, sıralar) → `localStorage`.
 * - Yüklenen görsel Blob'ları → IndexedDB (`src/lib/image-store.ts`).
 * - `blob:` object URL'leri ASLA localStorage'a yazılmaz; yazılmadan önce
 *   `toPersistableState` ile IndexedDB referanslarına çevrilir veya düşülür.
 *
 * Tüm fonksiyonlar saf (pure) ve tarayıcı bağımsızdır; `StorageLike`
 * arayüzü üzerinden test edilir.
 */

/** Depolama şeması sürümü; artırıldığında eski veri bilinçli olarak reddedilir. */
export const STORAGE_VERSION = 1;

/** localStorage anahtarı. */
export const STORAGE_KEY = "dijivo-grid-state";

/** Tarayıcı `localStorage`'a benzer minimal arayüz (testlerde enjekte edilir). */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Kalıcı hale getirilebilecek uygulama durumunun şeması. */
export interface PersistedAppState {
  version: number;
  brand: Brand;
  existingPosts: ExistingPost[];
  plannedPosts: PlannedPost[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function isAspectRatio(value: unknown): boolean {
  return (
    value === undefined ||
    value === "1:1" ||
    value === "3:4" ||
    value === "4:3" ||
    value === "16:9"
  );
}

function isBrand(value: unknown): value is Brand {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.username === "string" &&
    isOptionalString(value.profileImageUrl) &&
    isOptionalString(value.bio)
  );
}

function isExistingPost(value: unknown): value is ExistingPost {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    value.source === "mevcut" &&
    typeof value.imageUrl === "string" &&
    isOptionalString(value.alt) &&
    isAspectRatio(value.aspectRatio) &&
    typeof value.recencyIndex === "number" &&
    typeof value.pinned === "boolean" &&
    (value.pinnedOrder === undefined || typeof value.pinnedOrder === "number")
  );
}

function isPlannedPost(value: unknown): value is PlannedPost {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    value.source === "planlanan" &&
    typeof value.imageUrl === "string" &&
    isOptionalString(value.alt) &&
    isAspectRatio(value.aspectRatio) &&
    typeof value.planOrder === "number"
  );
}

function parseExistingPosts(value: unknown): ExistingPost[] | null {
  if (!Array.isArray(value)) return null;
  const posts: ExistingPost[] = [];
  for (const item of value) {
    if (!isExistingPost(item)) return null;
    posts.push(item);
  }
  return posts;
}

function parsePlannedPosts(value: unknown): PlannedPost[] | null {
  if (!Array.isArray(value)) return null;
  const posts: PlannedPost[] = [];
  for (const item of value) {
    if (!isPlannedPost(item)) return null;
    posts.push(item);
  }
  return posts;
}

/** Durumu JSON metnine çevirir (şema sürümü eklenir). */
export function serializeAppState(state: PersistedAppState): string {
  return JSON.stringify({
    version: STORAGE_VERSION,
    brand: state.brand,
    existingPosts: state.existingPosts,
    plannedPosts: state.plannedPosts,
  });
}

/**
 * JSON metnini doğrular ve duruma çevirir.
 * Bozuk veri, yanlış sürüm veya geçersiz şekil → `null` (çağıran demo
 * varsayılanlarına döner; uygulama asla bozuk veriyle çalışmaz).
 */
export function deserializeAppState(
  json: string | null | undefined,
): PersistedAppState | null {
  if (!json) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (!isRecord(raw)) return null;
  // Şema sürümü eşleşmiyorsa (gelecek/eski sürüm) reddet.
  if (raw.version !== STORAGE_VERSION) return null;
  if (!isBrand(raw.brand)) return null;
  const existingPosts = parseExistingPosts(raw.existingPosts);
  if (!existingPosts) return null;
  const plannedPosts = parsePlannedPosts(raw.plannedPosts);
  if (!plannedPosts) return null;
  return {
    version: STORAGE_VERSION,
    brand: raw.brand,
    existingPosts,
    plannedPosts,
  };
}

/** localStorage'dan durumu okur; her türlü hatada `null` döner. */
export function readPersistedState(
  storage: StorageLike | null | undefined,
): PersistedAppState | null {
  if (!storage) return null;
  try {
    return deserializeAppState(storage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

/** Durumu localStorage'a yazar; kota/erişim hatasında `false` döner. */
export function writePersistedState(
  storage: StorageLike | null | undefined,
  state: PersistedAppState,
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(STORAGE_KEY, serializeAppState(state));
    return true;
  } catch {
    return false;
  }
}

/** Kalıcı veriyi temizler (sıfırlama). */
export function clearPersistedState(storage: StorageLike | null | undefined): void {
  if (!storage) return;
  try {
    storage.removeItem(STORAGE_KEY);
  } catch {
    // yok say: temizleme hatası uygulamayı düşürmez
  }
}

/**
 * Açılışta kullanılacak durumu seçer: kayıtlı veri geçerliyse o, değilse
 * verilen varsayılanlar (demo verisi).
 */
export function loadAppState(
  storage: StorageLike | null | undefined,
  defaults: PersistedAppState,
): PersistedAppState {
  return readPersistedState(storage) ?? defaults;
}

/**
 * State'i kalıcı yazılabilir hale getirir:
 * - `idb:` referansları ve normal http(s) URL'leri aynen korunur.
 * - `blob:` object URL'leri haritada IndexedDB referansına çevrilir.
 * - Haritada olmayan `blob:` URL'leri yazılmaz (localStorage'a `blob:` asla
 *   girmez): profil görseli düşer, gönderi kalıcılaştırılamadıysa listeden
 *   çıkar (oturum boyunca görünür kalır).
 */
export function toPersistableState(
  state: PersistedAppState,
  refByObjectUrl: ReadonlyMap<string, string>,
): PersistedAppState {
  const resolveUrl = (url: string | undefined): string | undefined => {
    if (url === undefined) return undefined;
    const mapped = refByObjectUrl.get(url);
    if (mapped !== undefined) return mapped;
    if (url.startsWith("blob:")) return undefined;
    return url;
  };

  const profileImageUrl = resolveUrl(state.brand.profileImageUrl);

  const existingPosts: ExistingPost[] = [];
  for (const post of state.existingPosts) {
    const imageUrl = resolveUrl(post.imageUrl);
    if (imageUrl === undefined) continue;
    existingPosts.push({ ...post, imageUrl });
  }

  const plannedPosts: PlannedPost[] = [];
  for (const post of state.plannedPosts) {
    const imageUrl = resolveUrl(post.imageUrl);
    if (imageUrl === undefined) continue;
    plannedPosts.push({ ...post, imageUrl });
  }

  return {
    version: STORAGE_VERSION,
    brand: { ...state.brand, profileImageUrl },
    existingPosts,
    plannedPosts,
  };
}
