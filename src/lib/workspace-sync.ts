import type { PersistedAppState, StorageLike } from "./storage";
import type { Brand, ExistingPost, PlannedPost } from "./types";

/**
 * Cihazlar arası workspace senkronizasyonu için saf yardımcılar.
 *
 * Sorunun özeti: push yalnız upsert yapıyordu (silme buluta hiç gitmiyordu),
 * açılışta yerel önbellek uzak veriyle "birleştirilip" geri yazılıyordu ve
 * açık bir sekme başka cihazın değişikliğini hiç çekmiyordu. Buradaki
 * fonksiyonlar bu üç davranışın kararlarını test edilebilir kılar.
 */

export interface SyncedIds {
  postIds: string[];
  highlightIds: string[];
}

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

const CLEAN_KEY_PREFIX = "dijivo-workspace-sync-clean:";

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

type MediaMapper = (url: string) => string;

/**
 * Kullanıcının görebildiği içeriğin kararlı imzası. Medya URL'leri (imzalı
 * URL/blob) kanonik referansa indirgenir; böylece yalnız imza süresi
 * yenilenen bir çekim "değişiklik" sayılmaz ve ekran gereksiz yenilenmez.
 * Aktif marka/proje seçimi cihaza özgü bir görünüm tercihidir; imzaya girmez.
 */
export function workspaceSignature(state: PersistedAppState, canonicalMedia: MediaMapper): string {
  const media = (value: string | undefined) => (value ? canonicalMedia(value) : null);
  const brand = (item: Brand) => [
    item.id, item.name, item.username, item.displayName ?? null, media(item.profileImageUrl), item.bio ?? null,
    item.website ?? null, item.phone ?? null, item.email ?? null, item.category ?? null,
    item.postCount ?? null, item.followersCount ?? null, item.followingCount ?? null,
    item.hashtagGroups ?? [], item.defaultMentions ?? [], item.defaultCtas ?? [],
    (item.highlights ?? []).map((highlight) => [highlight.id, highlight.title, media(highlight.imageUrl)]),
  ];
  const post = (item: ExistingPost | PlannedPost) => [
    item.id, item.source, media(item.imageUrl), item.alt ?? null, item.aspectRatio ?? null, item.postType ?? null,
    item.caption ?? null, item.mediaType ?? null, media(item.videoUrl), media(item.coverImageUrl),
    item.externalUrl ?? null, "recencyIndex" in item ? item.recencyIndex : null, "planOrder" in item ? item.planOrder : null,
    "pinned" in item ? item.pinned : null, "pinnedOrder" in item ? item.pinnedOrder ?? null : null, item.gridOrder ?? null,
  ];
  return JSON.stringify([
    (state.brands ?? []).map(brand),
    (state.projects ?? []).map((project) => [
      project.id, project.name, project.month, project.year, project.brandId ?? null,
      project.existingPosts.map(post), project.plannedPosts.map(post),
      (project.stories ?? []).map((story) => [story.id, story.mediaType, media(story.mediaUrl), story.sortOrder]),
    ]),
  ]);
}
