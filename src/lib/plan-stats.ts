import type { ExistingPost, PlannedPost, PostType } from "./types";

/** Medya paneli tür filtresi. */
export type TypeFilter = "all" | PostType;

/** Bir planın (mevcut + planlanan) gerçek dağılım metrikleri. Yüzdeler üretilmez. */
export interface PlanStats {
  total: number;
  existing: number;
  planned: number;
  pinned: number;
  post: number;
  reel: number;
  carousel: number;
}

function normalizedType(postType: PostType | undefined): PostType {
  return postType ?? "post";
}

/** Görselleri tür filtresine göre süzer; `all` diziyi aynen döner. */
export function filterByType<T extends { postType?: PostType }>(
  posts: T[],
  filter: TypeFilter,
): T[] {
  if (filter === "all") return posts;
  return posts.filter((post) => normalizedType(post.postType) === filter);
}

/** Mevcut + planlanan gönderilerden plan istatistiklerini hesaplar. */
export function computePlanStats(
  existing: ExistingPost[],
  planned: PlannedPost[],
): PlanStats {
  const stats: PlanStats = {
    total: existing.length + planned.length,
    existing: existing.length,
    planned: planned.length,
    pinned: existing.filter((post) => post.pinned).length,
    post: 0,
    reel: 0,
    carousel: 0,
  };
  for (const post of [...existing, ...planned]) {
    const type = normalizedType(post.postType);
    if (type === "reel") stats.reel += 1;
    else if (type === "carousel") stats.carousel += 1;
    else stats.post += 1;
  }
  return stats;
}
