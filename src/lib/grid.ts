import type {
  AnyPost,
  ExistingPost,
  GridCell,
  GridResult,
  PlannedPost,
} from "./types";

export const GRID_COLUMNS = 3;
/** Instagram profilinde en fazla 3 gönderi sabitlenebilir */
export const MAX_PINNED = 3;

export function isExistingPost(post: AnyPost): post is ExistingPost {
  return post.source === "mevcut";
}

export function isPlannedPost(post: AnyPost): post is PlannedPost {
  return post.source === "planlanan";
}

/**
 * Pinned gönderileri döndürür: en fazla 3 adet, pinnedOrder'a göre artan sıralı.
 * Sırası olmayan pinned gönderiler, sıralı olanların arkasına, kendi aralarında
 * recencyIndex'e göre (en yeni önce) yerleşir.
 */
export function pickPinnedPosts(posts: ExistingPost[]): ExistingPost[] {
  const pinned = posts.filter((post) => post.pinned);
  const withOrder = pinned
    .filter((post) => typeof post.pinnedOrder === "number")
    .sort((a, b) => (a.pinnedOrder ?? 0) - (b.pinnedOrder ?? 0));
  const withoutOrder = pinned
    .filter((post) => typeof post.pinnedOrder !== "number")
    .sort((a, b) => a.recencyIndex - b.recencyIndex);
  return [...withOrder, ...withoutOrder].slice(0, MAX_PINNED);
}

/**
 * Sabitlenmemiş içeriklerin (planlanan + mevcut) TEK ortak sırası.
 *
 * - Eski kural (gridOrder hiç yoksa): önce planlananlar (planOrder), sonra
 *   mevcutlar (recencyIndex). Eski projeler birebir aynı görünür.
 * - gridOrder'ı olan içerikler bu değere göre dizilir (planlanan/mevcut
 *   karışık olabilir).
 * - gridOrder'ı olmayan yeni içerik (yeni yükleme, pin kaldırma, başka
 *   projeden kopya) aynı kaynaktan komşusuna göre yerleşir: eski sıradaki
 *   bir önceki aynı-kaynak içeriğin hemen arkasına; yoksa bir sonraki
 *   aynı-kaynak içeriğin hemen önüne; o da yoksa planlanan başa, mevcut
 *   sona. Böylece eski davranış korunur: yeni planlanan gönderi (planOrder 0)
 *   planlananların başına, "en yeni" mevcut gönderi mevcutların başına,
 *   "en eski" mevcut gönderi en sona eklenir.
 */
export function orderNormalPosts(
  planned: PlannedPost[],
  unpinnedExisting: ExistingPost[],
): AnyPost[] {
  const legacy: AnyPost[] = [
    ...[...planned].sort((a, b) => a.planOrder - b.planOrder),
    ...[...unpinnedExisting].sort((a, b) => a.recencyIndex - b.recencyIndex),
  ];
  const hasOrder = (post: AnyPost) => typeof post.gridOrder === "number" && Number.isFinite(post.gridOrder);
  if (!legacy.some(hasOrder)) return legacy;

  const legacyIndex = new Map(legacy.map((post, index) => [post.id, index]));
  const result = legacy
    .filter(hasOrder)
    .sort((a, b) => (a.gridOrder ?? 0) - (b.gridOrder ?? 0) || (legacyIndex.get(a.id) ?? 0) - (legacyIndex.get(b.id) ?? 0));
  const placed = new Set(result.map((post) => post.id));

  legacy.forEach((post, index) => {
    if (placed.has(post.id)) return;
    const sameSource = (other: AnyPost) => other.source === post.source;
    const previous = legacy.slice(0, index).reverse().find(sameSource);
    const next = legacy.slice(index + 1).find((other) => sameSource(other) && placed.has(other.id));
    let at: number;
    if (previous) at = result.findIndex((other) => other.id === previous.id) + 1;
    else if (next) at = result.findIndex((other) => other.id === next.id);
    else at = post.source === "planlanan" ? 0 : result.length;
    result.splice(at, 0, post);
    placed.add(post.id);
  });
  return result;
}

/**
 * Profil gridini hesaplar.
 *
 * Kurallar (AI-HANDOFF.md §5):
 * - Grid 3 sütundur; en yeni içerik üst soldadır, soldan sağa ve üstten alta akar.
 * - Pinned gönderiler (en fazla 3) kendi soldan-sağa sıralarıyla en üstte durur.
 * - Pinned olmayan içerikler (planlanan + mevcut) tek ortak sırada akar
 *   (`orderNormalPosts`): gridOrder yoksa planlananlar mevcut akışın ÜSTÜNE
 *   eklenir; kullanıcı sürükleyerek ikisini karıştırabilir.
 * - Boş satırlar doldurulmaz; grid doğal akışta biter.
 */
export function computeGrid(
  brandPosts: ExistingPost[],
  plannedPosts: PlannedPost[],
): GridResult {
  const pinned = pickPinnedPosts(brandPosts);
  const pinnedIds = new Set(pinned.map((post) => post.id));

  // Pinned olmayan tüm içerikler (planlanan + mevcut) tek ortak sırada.
  const unpinnedExisting = brandPosts.filter((post) => !pinnedIds.has(post.id));
  const flow: AnyPost[] = [...pinned, ...orderNormalPosts(plannedPosts, unpinnedExisting)];

  const cells: GridCell[] = flow.map((post, position) => ({
    post,
    row: Math.floor(position / GRID_COLUMNS),
    column: position % GRID_COLUMNS,
    position,
    pinned: post.source === "mevcut" && pinnedIds.has(post.id),
  }));

  return {
    cells,
    rowCount: Math.ceil(flow.length / GRID_COLUMNS),
    pinnedCount: pinned.length,
  };
}
