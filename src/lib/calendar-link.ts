import type { AnyPost } from "./types";
import type { GridProject } from "./storage";

/**
 * Takvim ↔ Grid Planner bağlantı katmanı (§13/§14/§15).
 *
 * Takvim kayıtları Grid gönderilerini kopyalamaz; `postId`
 * referansıyla bağlanır. Bu modül referansı çözer:
 * - ok: post bulundu ve doğru markada
 * - missing: post silindi → "Bağlı içerik bulunamadı" (§37)
 * - cross-brand: post başka bir markaya ait → kesin reddedilir (§23)
 */

export interface LinkedPost {
  post: AnyPost;
  project: GridProject;
}

export type LinkResolution =
  | { status: "ok"; link: LinkedPost }
  | { status: "missing" }
  | { status: "cross-brand" }
  | { status: "none" };

/** Tüm projeler içinde gönderiyi (ve ait olduğu projeyi) bulur. */
export function findPostById(
  allProjects: GridProject[],
  postId: string | null | undefined,
): LinkedPost | null {
  if (!postId) return null;
  for (const project of allProjects) {
    const post =
      project.existingPosts.find((item) => item.id === postId) ??
      project.plannedPosts.find((item) => item.id === postId);
    if (post) return { post, project };
  }
  return null;
}

/**
 * Takvim kaydının postId'sini çözer (§15/§37).
 * `brandId` aktif markadır; başka markanın post'u kesin reddedilir.
 */
export function resolveCalendarLink(
  allProjects: GridProject[],
  postId: string | null | undefined,
  brandId: string,
): LinkResolution {
  if (!postId) return { status: "none" };
  const found = findPostById(allProjects, postId);
  if (!found) return { status: "missing" };
  // §23: cross-brand post relation kesin reddedilir.
  if (found.project.brandId && found.project.brandId !== brandId) {
    return { status: "cross-brand" };
  }
  return { status: "ok", link: found };
}

/**
 * "Mevcut Grid Planner içeriğini bağla" picker'ı için
 * seçenek listesi (§14): yalnızca aktif markanın gönderileri.
 */
export interface LinkedPostOption {
  postId: string;
  projectId: string;
  projectName: string;
  month: number;
  year: number;
  label: string;
  postType: string;
  hasVideo: boolean;
}

export function buildLinkedPostOptions(
  allProjects: GridProject[],
  brandId: string,
): LinkedPostOption[] {
  const options: LinkedPostOption[] = [];
  for (const project of allProjects) {
    // §23: yalnızca aynı markanın projeleri listelenir.
    if (project.brandId && project.brandId !== brandId) continue;
    const posts = [...project.existingPosts, ...project.plannedPosts];
    for (const post of posts) {
      options.push({
        postId: post.id,
        projectId: project.id,
        projectName: project.name,
        month: project.month,
        year: project.year,
        label: post.caption?.trim() || post.alt || "Başlıksız içerik",
        postType: post.postType ?? "post",
        hasVideo: post.mediaType === "video",
      });
    }
  }
  return options;
}
