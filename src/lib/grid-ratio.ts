import type { PostType } from "./types";

/**
 * Grid hücre oranı tek kaynaktan gelir: editör, paylaşım ekranı ve mini
 * önizleme aynı oranı kullanır. Post 3:4, Reel 2:3 (Post'tan daha dikey).
 * Tailwind sınıfları tam metin olarak burada durmalı (JIT taraması).
 */
export const POST_CELL_ASPECT_CLASS = "aspect-[3/4]";
export const REEL_CELL_ASPECT_CLASS = "aspect-[2/3]";

export function gridCellAspectClass(postType: PostType | undefined): string {
  return postType === "reel" ? REEL_CELL_ASPECT_CLASS : POST_CELL_ASPECT_CLASS;
}
