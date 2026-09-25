import type { ExistingPost, PlannedPost } from "./types";

export const MAX_PINNED = 3;
const PIN_LIMIT_MESSAGE = `En fazla ${MAX_PINNED} gönderi sabitlenebilir. Sabitlemek için önce pinned gönderilerden birinin sabitliğini kaldırın.`;

/**
 * Sabitlenmiş mevcut gönderileri döndürür: pinnedOrder'a göre artan sıralı.
 * Sırası olmayanlar (saf sayfa state'i) en sona, recencyIndex sırasına göre eklenir.
 */
export function listPinnedPosts(posts: ExistingPost[]): ExistingPost[] {
  const pinned = posts.filter((p) => p.pinned);
  const withOrder = pinned
    .filter((p) => typeof p.pinnedOrder === "number")
    .sort((a, b) => (a.pinnedOrder ?? 0) - (b.pinnedOrder ?? 0));
  const withoutOrder = pinned
    .filter((p) => typeof p.pinnedOrder !== "number")
    .sort((a, b) => a.recencyIndex - b.recencyIndex);
  return [...withOrder, ...withoutOrder];
}

/** Gönderiyi pinned yapar; 3 gönderi limiti aşılırsa hata mesajı döner. */
export function pinPost(
  posts: ExistingPost[],
  postId: string,
): { posts: ExistingPost[]; error?: string } {
  const target = posts.find((p) => p.id === postId);
  if (!target || target.pinned) return { posts };
  const pinnedCount = posts.filter((p) => p.pinned).length;
  if (pinnedCount >= MAX_PINNED) return { posts, error: PIN_LIMIT_MESSAGE };
  const maxOrder = listPinnedPosts(posts).length;
  return {
    posts: posts.map((p) =>
      p.id === postId ? { ...p, pinned: true, pinnedOrder: maxOrder } : p,
    ),
  };
}

/**
 * Gönderinin pinini kaldırır; kalan pinnedlerin sırası korunarak
 * pinnedOrder'lar 0'dan başlayacak şekilde yeniden yazılır.
 */
export function unpinPost(posts: ExistingPost[], postId: string): ExistingPost[] {
  const orderedPinned = listPinnedPosts(posts)
    .filter((p) => p.id !== postId)
    .map((p, i) => ({ id: p.id, pinnedOrder: i }));
  const renumbered = new Map(orderedPinned.map((p) => [p.id, p.pinnedOrder]));
  return posts.map((p) => {
    if (p.id === postId) return { ...p, pinned: false, pinnedOrder: undefined };
    const nextOrder = renumbered.get(p.id);
    return nextOrder === undefined ? p : { ...p, pinnedOrder: nextOrder };
  });
}

/**
 * Pinned bir gönderiyi soldan-sağa sırasında bir konum kaydırır.
 * direction: -1 sola, +1 sağa. Sınır dışıysa liste değişmez.
 */
export function movePinnedPost(
  posts: ExistingPost[],
  postId: string,
  direction: -1 | 1,
): ExistingPost[] {
  const ids = listPinnedPosts(posts).map((p) => p.id);
  const from = ids.indexOf(postId);
  const to = from + direction;
  if (from === -1 || to < 0 || to >= ids.length) return posts;
  [ids[from], ids[to]] = [ids[to], ids[from]];
  return reorderPinnedPosts(posts, ids);
}

/** Pinned gönderileri sıfıdan sıralar (sürükle-bırak sonrası). */
export function reorderPinnedPosts(
  posts: ExistingPost[],
  orderedIds: string[],
): ExistingPost[] {
  const orderIndex = new Map(orderedIds.map((id, i) => [id, i]));
  return posts.map((p) => {
    if (!p.pinned) return { ...p, pinnedOrder: undefined };
    const next = orderIndex.get(p.id);
    return { ...p, pinnedOrder: next === undefined ? p.pinnedOrder : next };
  });
}

/**
 * Yeni bir mevcut gönderi ekler. recency seçimi:
 * - "enYeni": 0 (kullanıcı "en yeni gönderi" diyor) → diğerlerinin recency'si 1 artar.
 * - "enEski": mevcut en büyük recency + 1.
 */
export function addExistingPost(
  posts: ExistingPost[],
  input: { imageUrl: string; alt?: string; recency: "enYeni" | "enEski" },
): { posts: ExistingPost[]; post: ExistingPost } {
  const maxRecency = posts.reduce((m, p) => Math.max(m, p.recencyIndex), -1);
  if (input.recency === "enYeni") {
    const shifted = posts.map((p) => ({ ...p, recencyIndex: p.recencyIndex + 1 }));
    const post: ExistingPost = {
      id: `mevcut-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      source: "mevcut",
      imageUrl: input.imageUrl,
      alt: input.alt,
      recencyIndex: 0,
      pinned: false,
    };
    return { posts: [post, ...shifted], post };
  }
  const post: ExistingPost = {
    id: `mevcut-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    source: "mevcut",
    imageUrl: input.imageUrl,
    alt: input.alt,
    recencyIndex: maxRecency + 1,
    pinned: false,
  };
  return { posts: [...posts, post], post };
}

/** Mevcut gönderiyi siler; kalan recency'leri 0'dan başlayarak yeniden yazar. */
export function deleteExistingPost(
  posts: ExistingPost[],
  postId: string,
): ExistingPost[] {
  const kept = posts
    .filter((p) => p.id !== postId)
    .sort((a, b) => a.recencyIndex - b.recencyIndex);
  return kept.map((p, i) => ({ ...p, recencyIndex: i, pinnedOrder: undefined }));
}

/** Yeni planlanan gönderi ekler: en yakın yayın olacak şekilde (planOrder 0). */
export function addPlannedPost(
  posts: PlannedPost[],
  input: { imageUrl: string; alt?: string },
): { posts: PlannedPost[]; post: PlannedPost } {
  const shifted = posts.map((p) => ({ ...p, planOrder: p.planOrder + 1 }));
  const post: PlannedPost = {
    id: `plan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    source: "planlanan",
    imageUrl: input.imageUrl,
    alt: input.alt,
    planOrder: 0,
  };
  return { posts: [post, ...shifted], post };
}

/** Planlanan gönderiyi siler; kalan planOrder'ları 0'dan başlayarak yeniden yazar. */
export function deletePlannedPost(
  posts: PlannedPost[],
  postId: string,
): PlannedPost[] {
  const kept = posts
    .filter((p) => p.id !== postId)
    .sort((a, b) => a.planOrder - b.planOrder);
  return kept.map((p, i) => ({ ...p, planOrder: i }));
}

/** Planlanan gönderileri sürükle-bırak sonrasındaki görünen sıraya göre sıralar. */
export function reorderPlannedPosts(
  posts: PlannedPost[],
  orderedIds: string[],
): PlannedPost[] {
  const orderIndex = new Map(orderedIds.map((id, i) => [id, i]));
  return posts.map((p) => {
    const next = orderIndex.get(p.id);
    return next === undefined ? p : { ...p, planOrder: next };
  });
}
