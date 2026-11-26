import type { ExistingPost, PlannedPost, PostType } from "./types";

/**
 * Grid hücre oranı ve hücre medyası tek kaynaktan gelir: editör, paylaşım
 * ekranı, mini önizleme ve PDF/JPG export aynı kararı kullanır.
 * Post ve Reel aynı 3:4 hücrede gösterilir. Bu yalnızca GRID gösterimidir;
 * Reel'in gerçek 9:16 medyası ve orijinal dosyalar değişmez (detay
 * ekranları gerçek oranı kullanır).
 * Tailwind sınıfları tam metin olarak burada durmalı (JIT taraması).
 */
export const POST_CELL_ASPECT_CLASS = "aspect-[3/4]";
export const REEL_CELL_ASPECT_CLASS = "aspect-[3/4]";

/** Yükseklik / genişlik: Post ve Reel 3:4 → 4/3. */
export const POST_CELL_HEIGHT_RATIO = 4 / 3;
export const REEL_CELL_HEIGHT_RATIO = 4 / 3;
/** Gridde görülebilecek en uzun hücre (sayfa yerleşimi için üst sınır). */
export const MAX_CELL_HEIGHT_RATIO = REEL_CELL_HEIGHT_RATIO;

export function isReelCell(postType: PostType | undefined): boolean {
  return postType === "reel";
}

export function gridCellAspectClass(postType: PostType | undefined): string {
  return isReelCell(postType) ? REEL_CELL_ASPECT_CLASS : POST_CELL_ASPECT_CLASS;
}

export function gridCellHeightRatio(postType: PostType | undefined): number {
  return isReelCell(postType) ? REEL_CELL_HEIGHT_RATIO : POST_CELL_HEIGHT_RATIO;
}

/**
 * Hücrede gösterilen görsel: videolu Reel'de kapak varsa kapak, yoksa ana
 * görsel (eski Reel kayıtları için güvenli fallback).
 */
export function gridCellMediaSrc(post: Pick<ExistingPost | PlannedPost, "mediaType" | "coverImageUrl" | "imageUrl">): string {
  return post.mediaType === "video" && post.coverImageUrl ? post.coverImageUrl : post.imageUrl;
}
