import type { PersistedAppState, StorageLike } from "./storage";
import type { Brand, ExistingPost, Highlight, PlannedPost, Story } from "./types";

/**
 * Cihazlar arası workspace senkronizasyonu için saf yardımcılar.
 *
 * Temel fikir: her varlığın (marka, proje, gönderi, öne çıkan, story) içeriği
 * kısa bir parmak iziyle (fingerprint) temsil edilir. Cihaz, buluttaki son
 * bilinen durumun parmak izlerini (baseline) saklar ve buluta YALNIZCA baseline'dan
 * farklı olan varlıkları yazar. Böylece bayat bir cihaz, başka cihazın değiştirdiği
 * veya sildiği kayıtları ezemez/diriltemez.
 */

export interface SyncedIds {
  postIds: string[];
  highlightIds: string[];
}

/** Varlık kimliği → içerik parmak izi. */
export interface SyncFingerprints {
  brands: Record<string, string>;
  projects: Record<string, string>;
  posts: Record<string, string>;
  highlights: Record<string, string>;
  stories: Record<string, string>;
}

/** Buluta yazılacak (baseline'dan farklı) varlık kimlikleri. */
export interface PushScope {
  brandIds: ReadonlySet<string>;
  projectIds: ReadonlySet<string>;
  postIds: ReadonlySet<string>;
  highlightIds: ReadonlySet<string>;
  storyIds: ReadonlySet<string>;
}

export type MediaMapper = (url: string) => string;

export const EMPTY_SYNCED_IDS: SyncedIds = { postIds: [], highlightIds: [] };

/** Durumdaki tüm gönderi ve öne çıkan kimlikleri (tüm projeler/markalar). */
export function collectSyncedIds(state: PersistedAppState): SyncedIds {
  const postIds = new Set<string>();
  const highlightIds = new Set<string>();
  for (const project of state.projects ?? []) {
    for (const post of [...project.existingPosts, ...project.plannedPosts]) postIds.add(post.id);
  }
  for (const brand of state.brands ?? []) {
    for (const highlight of brand.highlights ?? []) highlightIds.add(highlight.id);
  }
  return { postIds: [...postIds], highlightIds: [...highlightIds] };
}

/**
 * Önceki başarılı eşitlemede bulunup şimdi durumdan çıkan kimlikler:
 * kullanıcı bunları silmiştir ve buluttan da silinmelidir. Hiç eşitlenmemiş
 * (ör. medyası çözülemediği için hydration'da düşen) kayıtlar buraya girmez,
 * dolayısıyla yanlışlıkla silinmez.
 */
export function computeRemovedIds(previous: SyncedIds, current: SyncedIds): SyncedIds {
  const posts = new Set(current.postIds);
  const highlights = new Set(current.highlightIds);
  return {
    postIds: previous.postIds.filter((id) => !posts.has(id)),
    highlightIds: previous.highlightIds.filter((id) => !highlights.has(id)),
  };
}

export function idsOfFingerprints(fingerprints: SyncFingerprints): SyncedIds {
  return { postIds: Object.keys(fingerprints.posts), highlightIds: Object.keys(fingerprints.highlights) };
}

// ---------------------------------------------------------------------------
// Parmak izleri
// ---------------------------------------------------------------------------

/** Kriptografik olmayan, iki bağımsız 32 bit FNV varyantı (64 bit) + uzunluk. */
function hashText(text: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x9747b28c;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ code, 0x85ebca6b) >>> 0;
    h2 = (h2 ^ (h2 >>> 13)) >>> 0;
  }
  return `${h1.toString(16)}${h2.toString(16)}.${text.length.toString(16)}`;
}

const media = (canonical: MediaMapper, value: string | undefined) => (value ? canonical(value) : null);

export function brandFingerprint(brand: Brand, canonical: MediaMapper): string {
  return hashText(JSON.stringify([
    brand.id, brand.name, brand.username, brand.displayName ?? null, media(canonical, brand.profileImageUrl), brand.bio ?? null,
    brand.website ?? null, brand.phone ?? null, brand.email ?? null, brand.category ?? null,
    brand.postCount ?? null, brand.followersCount ?? null, brand.followingCount ?? null,
    brand.hashtagGroups ?? [], brand.defaultMentions ?? [], brand.defaultCtas ?? [],
  ]));
}

export function highlightFingerprint(highlight: Highlight, brandId: string, canonical: MediaMapper): string {
  return hashText(JSON.stringify([highlight.id, brandId, highlight.title, media(canonical, highlight.imageUrl)]));
}

export function projectFingerprint(project: { id: string; name: string; month: number; year: number; brandId?: string | null; brand: Brand }): string {
  return hashText(JSON.stringify([project.id, project.name, project.month, project.year, project.brandId ?? project.brand.id]));
}

export function postFingerprint(post: ExistingPost | PlannedPost, projectId: string, canonical: MediaMapper): string {
  return hashText(JSON.stringify([
    post.id, projectId, post.source, media(canonical, post.imageUrl), post.alt ?? null, post.aspectRatio ?? null, post.postType ?? null,
    post.caption ?? null, post.mediaType ?? null, media(canonical, post.videoUrl), media(canonical, post.coverImageUrl),
    post.externalUrl ?? null, "recencyIndex" in post ? post.recencyIndex : null, "planOrder" in post ? post.planOrder : null,
    "pinned" in post ? post.pinned : null, "pinnedOrder" in post ? post.pinnedOrder ?? null : null, post.gridOrder ?? null,
  ]));
}

export function storyFingerprint(story: Story, projectId: string, canonical: MediaMapper): string {
  return hashText(JSON.stringify([story.id, projectId, story.mediaType, media(canonical, story.mediaUrl), story.sortOrder, story.createdAt ?? null, story.expiresAt ?? null]));
}

export function emptyFingerprints(): SyncFingerprints {
  return { brands: {}, projects: {}, posts: {}, highlights: {}, stories: {} };
}

export function fingerprintState(state: PersistedAppState, canonical: MediaMapper): SyncFingerprints {
  const result = emptyFingerprints();
  for (const brand of state.brands ?? []) {
    result.brands[brand.id] = brandFingerprint(brand, canonical);
    for (const highlight of brand.highlights ?? []) result.highlights[highlight.id] = highlightFingerprint(highlight, brand.id, canonical);
  }
  for (const project of state.projects ?? []) {
    result.projects[project.id] = projectFingerprint(project);
    for (const post of [...project.existingPosts, ...project.plannedPosts]) result.posts[post.id] = postFingerprint(post, project.id, canonical);
    for (const story of project.stories ?? []) result.stories[story.id] = storyFingerprint(story, project.id, canonical);
  }
  return result;
}

function changedIds(current: Record<string, string>, baseline: Record<string, string>): Set<string> {
  const changed = new Set<string>();
  for (const [id, value] of Object.entries(current)) if (baseline[id] !== value) changed.add(id);
  return changed;
}

/** `current`'ta olup `baseline`'da olmayan veya içeriği farklı olan varlıklar. */
export function changedEntities(current: SyncFingerprints, baseline: SyncFingerprints): PushScope {
  return {
    brandIds: changedIds(current.brands, baseline.brands),
    projectIds: changedIds(current.projects, baseline.projects),
    postIds: changedIds(current.posts, baseline.posts),
    highlightIds: changedIds(current.highlights, baseline.highlights),
    storyIds: changedIds(current.stories, baseline.stories),
  };
}

// ---------------------------------------------------------------------------
// Baseline kalıcılığı + temiz-senkron işareti
// ---------------------------------------------------------------------------

const CLEAN_KEY_PREFIX = "dijivo-workspace-sync-clean:";
const BASELINE_KEY_PREFIX = "dijivo-workspace-sync-baseline:";

/**
 * "Yerel kopya buluttan beri değişmedi" işareti. `false`: bekleyen/başarısız
 * yazım var → açılışta yerel değişiklikler korunarak birleştirilir.
 * `null`: bilinmiyor (eski sürümden geliş) → birleştirme (eski davranış).
 */
export function readSyncClean(storage: StorageLike | null, userId: string): boolean | null {
  try {
    const value = storage?.getItem(`${CLEAN_KEY_PREFIX}${userId}`);
    if (value === "1") return true;
    if (value === "0") return false;
    return null;
  } catch {
    return null;
  }
}

export function writeSyncClean(storage: StorageLike | null, userId: string, clean: boolean): void {
  try {
    storage?.setItem(`${CLEAN_KEY_PREFIX}${userId}`, clean ? "1" : "0");
  } catch {
    // depolama kapalıysa işaret tutulamaz; sonraki açılış birleştirir
  }
}

/** Açılışta uzak veri tek gerçek kaynak mı, yoksa yerel değişiklikler birleştirilmeli mi? */
export function shouldTrustRemote(clean: boolean | null): boolean {
  return clean === true;
}

function isRecordOfStrings(value: unknown): value is Record<string, string> {
  return typeof value === "object" && value !== null && !Array.isArray(value) &&
    Object.values(value as Record<string, unknown>).every((item) => typeof item === "string");
}

/** Bu cihazın buluttaki son bilinen durumu; yoksa/bozuksa `null`. */
export function readBaseline(storage: StorageLike | null, userId: string): SyncFingerprints | null {
  try {
    const raw = storage?.getItem(`${BASELINE_KEY_PREFIX}${userId}`);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<Record<keyof SyncFingerprints, unknown>>;
    if (!isRecordOfStrings(value.brands) || !isRecordOfStrings(value.projects) || !isRecordOfStrings(value.posts) ||
        !isRecordOfStrings(value.highlights) || !isRecordOfStrings(value.stories)) return null;
    return { brands: value.brands, projects: value.projects, posts: value.posts, highlights: value.highlights, stories: value.stories };
  } catch {
    return null;
  }
}

export function writeBaseline(storage: StorageLike | null, userId: string, baseline: SyncFingerprints | null): void {
  try {
    if (baseline) storage?.setItem(`${BASELINE_KEY_PREFIX}${userId}`, JSON.stringify(baseline));
    else storage?.removeItem(`${BASELINE_KEY_PREFIX}${userId}`);
  } catch {
    // baseline tutulamazsa sonraki açılış birleştirme moduna düşer
  }
}

/**
 * Kullanıcının görebildiği içeriğin kararlı imzası (ekran yenileme kararı için).
 * Medya URL'leri `canonicalMedia` ile kanonik referansa indirgenir; böylece yalnız
 * imza süresi yenilenen bir çekim "değişiklik" sayılmaz. Aktif marka/proje seçimi
 * cihaza özgü bir görünüm tercihidir; imzaya girmez.
 */
export function workspaceSignature(state: PersistedAppState, canonicalMedia: MediaMapper): string {
  const fingerprints = fingerprintState(state, canonicalMedia);
  const sorted = (record: Record<string, string>) => Object.keys(record).sort().map((id) => [id, record[id]]);
  return JSON.stringify([sorted(fingerprints.brands), sorted(fingerprints.projects), sorted(fingerprints.posts), sorted(fingerprints.highlights), sorted(fingerprints.stories)]);
}
