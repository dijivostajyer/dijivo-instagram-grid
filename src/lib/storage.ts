import type { Brand, ExistingPost, PlannedPost, PostType } from "./types";

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
export const STORAGE_VERSION = 3;

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
  /** v2: birden çok takvim projesi. Eski kayıtlar açılışta tek projeye taşınır. */
  projects?: GridProject[];
  activeProjectId?: string;
  /**
   * v3: çok markalı workspace kayıt defteri. v2 kayıtları açılışta
   * otomatik olarak burada toplanır (veri kaybı yok).
   */
  brands?: Brand[];
  activeBrandId?: string;
}

export interface GridProject {
  id: string;
  name: string;
  month: number;
  year: number;
  createdAt: string;
  updatedAt: string;
  brand: Brand;
  /** v3: bu projenin ait olduğu marka (brands[] içindeki id).
   * Kalıtsal JSON verilerinde `null` da görülebilir; okuma tarafı her zaman
   * falsy-kontrolü ile ele alır. */
  brandId?: string | null;
  existingPosts: ExistingPost[];
  plannedPosts: PlannedPost[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function isStringArray(value: unknown): boolean {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isHashtagGroup(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    isStringArray(value.tags)
  );
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

function isPostType(value: unknown): value is PostType {
  return value === undefined || value === "post" || value === "reel" || value === "carousel";
}

function isMediaType(value: unknown): value is "image" | "video" {
  return value === undefined || value === "image" || value === "video";
}

function isBrand(value: unknown): value is Brand {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.username === "string" &&
    isOptionalString(value.displayName) &&
    isOptionalString(value.profileImageUrl) &&
    isOptionalString(value.bio) &&
    isOptionalString(value.website) &&
    isOptionalString(value.phone) &&
    isOptionalString(value.email) &&
    isOptionalString(value.category)
    && (value.postCount === undefined || typeof value.postCount === "number")
    && (value.followersCount === undefined || typeof value.followersCount === "number")
    && (value.followingCount === undefined || typeof value.followingCount === "number")
    && (value.highlights === undefined || (Array.isArray(value.highlights) && value.highlights.every((highlight) => isRecord(highlight) && typeof highlight.id === "string" && typeof highlight.title === "string" && isOptionalString(highlight.imageUrl))))
    && (value.hashtagGroups === undefined || (Array.isArray(value.hashtagGroups) && value.hashtagGroups.every(isHashtagGroup)))
    && (value.defaultMentions === undefined || isStringArray(value.defaultMentions))
    && (value.defaultCtas === undefined || isStringArray(value.defaultCtas))
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
    isPostType(value.postType) &&
    isOptionalString(value.caption) &&
    isMediaType(value.mediaType) &&
    isOptionalString(value.videoUrl) &&
    isOptionalString(value.coverImageUrl) &&
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
    isPostType(value.postType) &&
    isOptionalString(value.caption) &&
    isMediaType(value.mediaType) &&
    isOptionalString(value.videoUrl) &&
    isOptionalString(value.coverImageUrl) &&
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

function normalizePosts<T extends ExistingPost | PlannedPost>(posts: T[]): T[] {
  return posts.map((post) => ({ ...post, postType: post.postType ?? "post" }));
}

function currentProjectName(month: number, year: number): string {
  return new Intl.DateTimeFormat("tr-TR", { month: "long", year: "numeric" }).format(new Date(year, month - 1));
}

export function createProjectFromState(state: Omit<PersistedAppState, "projects" | "activeProjectId">, now = new Date()): GridProject {
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  const timestamp = now.toISOString();
  return { id: `project-${timestamp}`, name: currentProjectName(month, year), month, year, createdAt: timestamp, updatedAt: timestamp, brand: state.brand, existingPosts: normalizePosts(state.existingPosts), plannedPosts: normalizePosts(state.plannedPosts) };
}

function isProject(value: unknown): value is GridProject {
  if (!isRecord(value) || typeof value.id !== "string" || value.id.length === 0 || typeof value.name !== "string") return false;
  const month = value.month;
  const year = value.year;
  if (typeof month !== "number" || !Number.isInteger(month) || month < 1 || month > 12 || typeof year !== "number" || !Number.isInteger(year) || year < 2000 || year > 2100 || typeof value.createdAt !== "string" || Number.isNaN(Date.parse(value.createdAt)) || typeof value.updatedAt !== "string" || Number.isNaN(Date.parse(value.updatedAt)) || !isBrand(value.brand)) return false;
  return parseExistingPosts(value.existingPosts) !== null && parsePlannedPosts(value.plannedPosts) !== null;
}

/** Durumu JSON metnine çevirir (şema sürümü eklenir). */
export function serializeAppState(state: PersistedAppState): string {
  return JSON.stringify({
    version: STORAGE_VERSION,
    brand: state.brand,
    existingPosts: state.existingPosts,
    plannedPosts: state.plannedPosts,
    projects: state.projects,
    activeProjectId: state.activeProjectId,
    brands: state.brands,
    activeBrandId: state.activeBrandId,
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
  if (raw.version !== 1 && raw.version !== 2 && raw.version !== STORAGE_VERSION) return null;
  if (!isBrand(raw.brand)) return null;
  const existingPosts = parseExistingPosts(raw.existingPosts);
  if (!existingPosts) return null;
  const plannedPosts = parsePlannedPosts(raw.plannedPosts);
  if (!plannedPosts) return null;
  const legacyState = {
    version: STORAGE_VERSION,
    brand: raw.brand as Brand,
    existingPosts,
    plannedPosts,
  };

  // Projeleri çöz: v1 tek projeye taşınır; v2/v3 doğrulandıktan sonra korunur.
  let projects: GridProject[] | undefined;
  let activeProjectId: string | undefined;
  if (raw.version === 1) {
    const project = createProjectFromState(legacyState, new Date(0));
    projects = [project];
    activeProjectId = project.id;
  } else if (raw.projects !== undefined) {
    if (!Array.isArray(raw.projects) || typeof raw.activeProjectId !== "string") return null;
    if (!raw.projects.every(isProject)) return null;
    const ids = raw.projects.map((project) => project.id);
    if (new Set(ids).size !== ids.length) return null;
    if (raw.activeProjectId !== "" && !ids.includes(raw.activeProjectId)) return null;
    projects = raw.projects.map((project) => ({ ...project, existingPosts: normalizePosts(project.existingPosts), plannedPosts: normalizePosts(project.plannedPosts) }));
    activeProjectId = raw.activeProjectId;
  }

  // v3 marka katmanı.
  if (raw.brands === undefined) {
    // v1/v2 kaydı: eski tek-marka verisi, brands[] altında toplanır (veri kaybı yok).
    if (raw.version === 1 || raw.version === 2) {
      const brands = collectBrands(legacyState.brand, projects);
      const activeBrandId = legacyState.brand.id;
      return {
        ...legacyState,
        projects: projects?.map((project) => ({ ...project, brandId: brandIdFor(project.brand, brands) })),
        activeProjectId,
        brands,
        activeBrandId,
      };
    }
    // v3 markasız kayıt: aynen korunur (brandless roundtrip).
    return { ...legacyState, projects, activeProjectId };
  }

  // v3 çok-marka kayıt: brands[] ve activeBrandId doğrulanır.
  if (!Array.isArray(raw.brands)) return null;
  if (raw.brands.length === 0) {
    if (raw.activeBrandId !== undefined && raw.activeBrandId !== "") return null;
    return { ...legacyState, projects, activeProjectId, brands: [], activeBrandId: "" };
  }
  if (!raw.brands.every(isBrand)) return null;
  const brandIds = raw.brands.map((brand) => brand.id);
  if (new Set(brandIds).size !== brandIds.length) return null;
  if (typeof raw.activeBrandId !== "string" || !brandIds.includes(raw.activeBrandId)) return null;
  return { ...legacyState, projects, activeProjectId, brands: raw.brands as Brand[], activeBrandId: raw.activeBrandId };
}

/**
 * v2→v3 migration yardımcısı: üst düzey marka ve projelerin marka
 * ekranlarını tekrar etmeyerek tek bir kayıt defteri oluşturur.
 */
function collectBrands(topLevel: Brand, projects: GridProject[] | undefined): Brand[] {
  const brands: Brand[] = [topLevel];
  const seen = new Set<string>([topLevel.id]);
  for (const project of projects ?? []) {
    if (!seen.has(project.brand.id)) {
      seen.add(project.brand.id);
      brands.push(project.brand);
    }
  }
  return brands;
}

function brandIdFor(brand: Brand, brands: Brand[]): string {
  return brands.some((candidate) => candidate.id === brand.id) ? brand.id : brands[0].id;
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

  const persistBrand = (brand: Brand): Brand => ({
    ...brand,
    profileImageUrl: resolveUrl(brand.profileImageUrl),
    highlights: brand.highlights?.map((highlight) => ({ ...highlight, imageUrl: resolveUrl(highlight.imageUrl) })),
  });
  const profileImageUrl = resolveUrl(state.brand.profileImageUrl);

  // Phase 2 (§4/§9): reel video ve kapak URL'leri de blob: ise
  // düşülür; video referansları (idb-video:) aynen korunur.
  const persistPost = <T extends ExistingPost | PlannedPost>(post: T): T | null => {
    const imageUrl = resolveUrl(post.imageUrl);
    if (imageUrl === undefined) return null;
    return {
      ...post,
      imageUrl,
      videoUrl: resolveUrl(post.videoUrl),
      coverImageUrl: resolveUrl(post.coverImageUrl),
    };
  };

  const existingPosts: ExistingPost[] = [];
  for (const post of state.existingPosts) {
    const persisted = persistPost(post);
    if (persisted !== null) existingPosts.push(persisted);
  }

  const plannedPosts: PlannedPost[] = [];
  for (const post of state.plannedPosts) {
    const persisted = persistPost(post);
    if (persisted !== null) plannedPosts.push(persisted);
  }

  return {
    version: STORAGE_VERSION,
    brand: { ...persistBrand(state.brand), profileImageUrl },
    existingPosts,
    plannedPosts,
    projects: state.projects?.map((project) => ({ ...project, brand: persistBrand(project.brand), existingPosts: project.existingPosts.map(persistPost).filter((post): post is ExistingPost => post !== null), plannedPosts: project.plannedPosts.map(persistPost).filter((post): post is PlannedPost => post !== null) })),
    activeProjectId: state.activeProjectId,
    brands: state.brands?.map(persistBrand),
    activeBrandId: state.activeBrandId,
  };
}
