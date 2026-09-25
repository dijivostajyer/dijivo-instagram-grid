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
 * Profil gridini hesaplar.
 *
 * Kurallar (AI-HANDOFF.md §5):
 * - Grid 3 sütundur; en yeni içerik üst soldadır, soldan sağa ve üstten alta akar.
 * - Pinned gönderiler (en fazla 3) kendi soldan-sağa sıralarıyla en üstte durur.
 * - Planlanan gönderiler plan sırasına göre (0 = ilk yayınlanacak) mevcut akışın
 *   ÜSTÜNE eklenir.
 * - Pinned olmayan içerikler pinned alanın altından en-yeniden-en-eskiye akar:
 *   önce planlananlar (planOrder), sonra mevcutlar (recencyIndex).
 * - Boş satırlar doldurulmaz; grid doğal akışta biter.
 */
export function computeGrid(
  brandPosts: ExistingPost[],
  plannedPosts: PlannedPost[],
): GridResult {
  const pinned = pickPinnedPosts(brandPosts);
  const pinnedIds = new Set(pinned.map((post) => post.id));

  // Pinned olmayan mevcutlar: recencyIndex artan = en yeni önce.
  const unpinnedExisting = brandPosts
    .filter((post) => !pinnedIds.has(post.id))
    .sort((a, b) => a.recencyIndex - b.recencyIndex);

  // Planlananlar: planOrder artan = ilk yayınlanacak önce.
  const planned = [...plannedPosts].sort((a, b) => a.planOrder - b.planOrder);

  const flow: AnyPost[] = [...pinned, ...planned, ...unpinnedExisting];

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
