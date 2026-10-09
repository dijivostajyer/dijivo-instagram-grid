import { addExistingPost, addPlannedPost, pinPost } from "./post-ops";
import { findPreviousMonthProject, monthLabel } from "./project-ops";
import {
  STORAGE_VERSION,
  type GridProject,
  type PersistedAppState,
} from "./storage";
import type { Brand, ExistingPost, Highlight, PlannedPost } from "./types";

/**
 * §16: gönderi kopyalama seçenekleri. Görsel her zaman aktarılır;
 * pin durumu varsayılan olarak aktarılmaz. Kaynak proje değişmez.
 */
export interface PostCopyOptions {
  caption: boolean;
  postType: boolean;
  /** Hedef markanın hashtag grupları caption sonuna eklenir. */
  hashtags: boolean;
  pinned: boolean;
}

/**
 * Yeni marka oluşturma girdisi (onboarding / '+ Yeni Marka').
 * `name` ve `username` zorunludur; geri kalan alanlar isteğe bağlıdır.
 */
export interface NewBrandInput {
  name: string;
  username: string;
  displayName?: string;
  profileImageUrl?: string;
  bio?: string;
  website?: string;
  phone?: string;
  email?: string;
  category?: string;
  postCount?: number;
  followersCount?: number;
  followingCount?: number;
  /** Instagram import önizlemesinden kullanıcı tarafından seçilen gönderiler. */
  importedPosts?: Array<{ id: string; thumbnailUrl: string; mediaUrl?: string; caption?: string; type?: "post" | "carousel" | "reel" | "unknown" }>;
  /** Instagram import önizlemesinden kullanıcı tarafından seçilen öne çıkanlar. */
  importedHighlights?: Array<{ id: string; title: string; coverUrl?: string }>;
}

/**
 * Varsayılan durum: henüz marka yok → ilk açılış onboarding ekranını
 * gösterir (§2/§22). Şema uyumu için üst düzey `brand` alanı boş bir
 * yer tutucuyla doldurulur; `brands: []` ve `activeBrandId: ""`
 * depolama katmanı tarafından geçerli kabul edilir.
 */
export function getDefaultAppState(): PersistedAppState {
  return {
    version: STORAGE_VERSION,
    brand: { id: "", name: "", username: "" },
    existingPosts: [],
    plannedPosts: [],
    projects: [],
    activeProjectId: "",
    brands: [],
    activeBrandId: "",
  };
}

/**
 * Üst düzey `brand`/`existingPosts`/`plannedPosts`, aktif projenin
 * aynısıdır (mirror); gerçek kaynak `projects[]` içindeki projelerdir.
 */
export function syncActiveProject(
  state: PersistedAppState,
): PersistedAppState {
  if (!state.projects?.length || !state.activeProjectId) return state;
  return {
    ...state,
    projects: state.projects.map((project) =>
      project.id === state.activeProjectId
        ? {
            ...project,
            brand: state.brand,
            existingPosts: state.existingPosts,
            plannedPosts: state.plannedPosts,
            updatedAt: new Date().toISOString(),
          }
        : project,
    ),
  };
}

/**
 * Yeni marka oluşturur (§2/§3/§22): kayıt defterine (`brands[]`)
 * ekler, aktif yapar ve geçerli ay için boş bir aylık plan açarak
 * dashboard'ı hemen işlevsel kılar. Marka adı ve kullanıcı adı
 * olmadan workspace başlatılmaz — bu durumda `null` döner.
 */
export function createBrandState(
  current: PersistedAppState,
  input: NewBrandInput,
  now = new Date(),
): { state: PersistedAppState; brand: Brand } | null {
  const name = input.name.trim();
  const username = input.username.trim();
  if (!name || !username) return null;
  const timestamp = now.toISOString();
  const suffix = Math.random().toString(36).slice(2, 8);
  const brand: Brand = {
    id: `brand-${timestamp}-${suffix}`,
    name,
    username,
    displayName: input.displayName?.trim() || undefined,
    profileImageUrl: input.profileImageUrl,
    bio: input.bio?.trim() || undefined,
    website: input.website?.trim() || undefined,
    phone: input.phone?.trim() || undefined,
    email: input.email?.trim() || undefined,
    category: input.category?.trim() || undefined,
    postCount: input.postCount,
    followersCount: input.followersCount,
    followingCount: input.followingCount,
    highlights: (input.importedHighlights ?? []).map((highlight) => ({
      id: `instagram-highlight-${highlight.id}`,
      title: highlight.title,
      imageUrl: highlight.coverUrl,
    })),
    hashtagGroups: [],
    defaultMentions: [],
    defaultCtas: [],
  };
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  const project: GridProject = {
    id: `project-${timestamp}-${suffix}`,
    name: monthLabel(month, year),
    month,
    year,
    createdAt: timestamp,
    updatedAt: timestamp,
    brandId: brand.id,
    brand: { ...brand },
    existingPosts: (input.importedPosts ?? []).map((post, index) => ({
      id: `instagram-post-${post.id}`,
      source: "mevcut" as const,
      imageUrl: post.thumbnailUrl,
      videoUrl: post.type === "reel" ? post.mediaUrl : undefined,
      mediaType: post.type === "reel" && post.mediaUrl ? "video" as const : undefined,
      postType: post.type === "carousel" || post.type === "reel" ? post.type : "post",
      caption: post.caption,
      recencyIndex: index,
      pinned: false,
    })),
    plannedPosts: [],
  };
  const next: PersistedAppState = {
    ...current,
    brands: [...(current.brands ?? []), brand],
    activeBrandId: brand.id,
    activeProjectId: project.id,
    brand: project.brand,
    existingPosts: project.existingPosts,
    plannedPosts: project.plannedPosts,
    projects: [...(current.projects ?? []), project],
  };
  return { state: next, brand };
}

/**
 * Aktif markayı değiştirir (§5). Marka kayıt defteri tek kaynaktır;
 * proje aynaları taze olmayabilir. Seçilen markanın en son
 * güncellenmiş projesi aktif olur; projesi yoksa boş plan durumuyla
 * dashboard gösterilir. Bilinmeyen kimlik için `null` döner.
 */
export function selectBrandState(
  current: PersistedAppState,
  id: string,
): PersistedAppState | null {
  const brand = (current.brands ?? []).find((item) => item.id === id);
  if (!brand) return null;
  const latest = (current.projects ?? [])
    .filter((project) => project.brandId === id)
    .slice()
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
  if (latest) {
    return {
      ...current,
      activeBrandId: id,
      activeProjectId: latest.id,
      brand,
      existingPosts: latest.existingPosts,
      plannedPosts: latest.plannedPosts,
    };
  }
  return {
    ...current,
    activeBrandId: id,
    activeProjectId: "",
    brand,
    existingPosts: [],
    plannedPosts: [],
  };
}

/**
 * Aylık plan seçer (§5: sıkı marka izolasyonu). Aktif olmayan
 * markanın projesi seçilemez — bu durumda `null` döner. Marka
 * verisi kayıt defterinden gelir; proje aynası tarihsel
 * snapshot olabilir.
 */
export function selectProjectState(
  current: PersistedAppState,
  id: string,
): PersistedAppState | null {
  const project = current.projects?.find((item) => item.id === id);
  if (!project) return null;
  if (
    project.brandId &&
    current.activeBrandId &&
    project.brandId !== current.activeBrandId
  ) {
    return null;
  }
  const brand =
    (current.brands ?? []).find(
      (item) => item.id === (project.brandId ?? current.activeBrandId),
    ) ?? project.brand;
  return {
    ...current,
    activeProjectId: id,
    activeBrandId: project.brandId ?? current.activeBrandId,
    brand,
    existingPosts: project.existingPosts,
    plannedPosts: project.plannedPosts,
  };
}

/**
 * Uygulama açılış hedefi (§1/§15): 0 marka → onboarding,
 * 1 marka → doğrudan dashboard, 2+ marka → marka seçim
 * ekranı. Kullanıcı her açılışta seçim yapar; son kullanılan
 * markaya otomatik atlama yok.
 */
export type LaunchTarget = "onboarding" | "dashboard" | "brand-selection";

export function resolveLaunchTarget(brandCount: number): LaunchTarget {
  if (brandCount === 0) return "onboarding";
  if (brandCount === 1) return "dashboard";
  return "brand-selection";
}

/** Marka kartında gösterilen, state'ten hesaplanan gerçek bilgiler. */
export interface BrandCardStats {
  /** Markaya ait aylık plan sayısı. */
  projectCount: number;
  /** En son güncellenen (aktif) aylık plan; yoksa null. */
  latestProject: GridProject | null;
  /** Aktif plandaki toplam içerik sayısı (mevcut + planlanan). */
  contentCount: number;
  /** Son güncelleme zaman damgası (ISO); yoksa null. */
  lastUpdatedAt: string | null;
}

/**
 * Marka kartı istatistikleri (§3): yalnızca ilgili markanın
 * projeleri kullanılır; başka markanın verisi asla karışmaz.
 * En son güncellenen proje "aktif plan" olarak gösterilir.
 */
export function computeBrandCardStats(
  brandId: string,
  projects: GridProject[],
): BrandCardStats {
  const own = (projects ?? [])
    .filter((project) => project.brandId === brandId)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  const latestProject = own[0] ?? null;
  return {
    projectCount: own.length,
    latestProject,
    contentCount: latestProject
      ? latestProject.existingPosts.length + latestProject.plannedPosts.length
      : 0,
    lastUpdatedAt: latestProject?.updatedAt ?? null,
  };
}

/**
 * "Son güncelleme" gösterge metni (§3): aynı gün → "Bugün",
 * dün → "Dün", bu hafta → "N gün önce", daha eskisi →
 * tarihler (tr-TR).
 */
export function formatBrandActivity(iso: string, now = new Date()): string {
  const then = new Date(iso);
  const startOfDay = (date: Date) =>
    new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const days = Math.round((startOfDay(now) - startOfDay(then)) / 86_400_000);
  if (days <= 0) return "Bugün";
  if (days === 1) return "Dün";
  if (days < 7) return `${days} gün önce`;
  return then.toLocaleDateString("tr-TR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/**
 * İstenen markanın profilini, aktif marka bağlamını değiştirmeden
 * günceller (§8/§11: Marka Seçim ekranında `activeBrandId` yalnızca
 * "Markayı Aç" aksiyonunda değişir). Aktif marka düzenleniyorsa
 * üst düzey ayna da senkronize edilir.
 */
export function updateBrandState(
  current: PersistedAppState,
  id: string,
  next: Brand,
): PersistedAppState {
  const nextState: PersistedAppState = {
    ...current,
    brands: (current.brands ?? []).map((brand) =>
      brand.id === id ? next : brand,
    ),
    projects: (current.projects ?? []).map((project) =>
      project.brandId === id ? { ...project, brand: next } : project,
    ),
  };
  if (current.activeBrandId !== id) return nextState;
  return syncActiveProject({ ...nextState, brand: next });
}

/**
 * Aylık plan oluşturur (§4/§19). "Önceki ayı kopyala" yalnızca
 * aynı marka içinde kalır; başka marka asla otomatik kaynak
 * olarak seçilmez. Kaynak marka verisi kayıt defterinden gelir.
 */
export function createProjectState(
  current: PersistedAppState,
  name: string,
  month: number,
  year: number,
  copyPrevious: boolean,
): { state: PersistedAppState; projectId: string } | { error: string } {
  const synced = syncActiveProject(current);
  const brandId = synced.activeBrandId ?? "";
  const scopedProjects = (synced.projects ?? []).filter(
    (project) => project.brandId === brandId,
  );
  const previous = copyPrevious
    ? findPreviousMonthProject(scopedProjects, month, year, brandId)
    : null;
  if (copyPrevious && !previous) {
    return { error: "Önceki aya ait kopyalanacak proje bulunamadı." };
  }
  const source = previous
    ? {
        brand: synced.brand,
        existingPosts: previous.existingPosts,
        plannedPosts: previous.plannedPosts,
      }
    : {
        brand: { ...synced.brand, profileImageUrl: undefined },
        existingPosts: [],
        plannedPosts: [],
      };
  const timestamp = new Date().toISOString();
  const project: GridProject = {
    id: `project-${timestamp}-${Math.random().toString(36).slice(2, 8)}`,
    name: name.trim() || `${month}/${year}`,
    month,
    year,
    createdAt: timestamp,
    updatedAt: timestamp,
    brandId: brandId || undefined,
    brand: {
      ...source.brand,
      highlights: source.brand.highlights?.map((highlight) => ({
        ...highlight,
        id: `highlight-${timestamp}-${highlight.id}`,
      })),
    },
    existingPosts: source.existingPosts.map((post) => ({
      ...post,
      id: `existing-${timestamp}-${post.id}`,
    })),
    plannedPosts: source.plannedPosts.map((post) => ({
      ...post,
      id: `planned-${timestamp}-${post.id}`,
    })),
  };
  const next = {
    ...synced,
    activeProjectId: project.id,
    brand: project.brand,
    existingPosts: project.existingPosts,
    plannedPosts: project.plannedPosts,
    projects: [...(synced.projects ?? []), project],
  };
  return { state: next, projectId: project.id };
}

/**
 * Gönderiyi başka bir aylık plana (aynı veya başka marka) kopyalar
 * (§16/§20/§21). Yeni kimlik verir, kaynağı değiştirmez; görsel
 * URL'i paylaşılır (güvenli yaşam döngüsü). Hedef markanın
 * hashtag grupları seçildiğinde caption sonuna eklenir.
 */
export function copyPostToProjectState(
  current: PersistedAppState,
  postId: string,
  targetProjectId: string,
  options: PostCopyOptions,
): { state: PersistedAppState } | { error: string } {
  const synced = syncActiveProject(current);
  const allProjects = synced.projects ?? [];
  let sourceProject: GridProject | undefined;
  let sourcePost: ExistingPost | PlannedPost | undefined;
  for (const project of allProjects) {
    const found =
      project.existingPosts.find((post) => post.id === postId) ??
      project.plannedPosts.find((post) => post.id === postId);
    if (found) {
      sourceProject = project;
      sourcePost = found;
      break;
    }
  }
  if (!sourceProject || !sourcePost) return { error: "Kaynak gönderi bulunamadı." };
  const target = allProjects.find((project) => project.id === targetProjectId);
  if (!target) return { error: "Hedef proje bulunamadı." };
  if (target.id === sourceProject.id) return { error: "Gönderi zaten bu projede." };

  const targetBrand =
    (synced.brands ?? []).find((brand) => brand.id === target.brandId) ??
    target.brand;
  let caption = options.caption ? sourcePost.caption : undefined;
  if (options.hashtags) {
    const tags = (targetBrand.hashtagGroups ?? []).flatMap(
      (group) => group.tags,
    );
    if (tags.length > 0) {
      const line = tags.join(" ");
      caption = caption ? `${caption}\n\n${line}` : line;
    }
  }

  const timestamp = new Date().toISOString();
  if (sourcePost.source === "mevcut") {
    const { posts, post } = addExistingPost(target.existingPosts, {
      imageUrl: sourcePost.imageUrl,
      alt: sourcePost.alt,
      recency: "enYeni",
      postType: options.postType ? sourcePost.postType : undefined,
      aspectRatio: sourcePost.aspectRatio,
      caption,
      mediaType: sourcePost.mediaType,
      videoUrl: sourcePost.videoUrl,
      coverImageUrl: sourcePost.coverImageUrl,
    });
    let nextPosts = posts;
    if (options.pinned && (sourcePost as ExistingPost).pinned) {
      const pinnedResult = pinPost(posts, post.id);
      if (pinnedResult.error) return { error: pinnedResult.error };
      nextPosts = pinnedResult.posts;
    }        const projects = allProjects.map((project) =>
          project.id === target.id
            ? { ...project, existingPosts: nextPosts, updatedAt: timestamp }
            : project,
        );
        // Hedef aktif proje ise üst düzey ayna da güncellenmeli;
        // aksi halde syncActiveProject kopyayı eski aynayla üzerine yazar.
        const isActiveTarget = target.id === synced.activeProjectId;
        const next = {
          ...synced,
          projects,
          ...(isActiveTarget ? { existingPosts: nextPosts } : {}),
        };
        return { state: syncActiveProject(next) };
      }
      const { posts } = addPlannedPost(target.plannedPosts, {
        imageUrl: sourcePost.imageUrl,
        alt: sourcePost.alt,
        postType: options.postType ? sourcePost.postType : undefined,
        aspectRatio: sourcePost.aspectRatio,
        caption,
        mediaType: sourcePost.mediaType,
        videoUrl: sourcePost.videoUrl,
        coverImageUrl: sourcePost.coverImageUrl,
      });
      const projects = allProjects.map((project) =>
        project.id === target.id
          ? { ...project, plannedPosts: posts, updatedAt: timestamp }
          : project,
      );
      const isActiveTarget = target.id === synced.activeProjectId;
      const next = {
        ...synced,
        projects,
        ...(isActiveTarget ? { plannedPosts: posts } : {}),
      };
      return { state: syncActiveProject(next) };
    }

/**
 * Öne çıkanı başka bir markaya kopyalar (§17): yeni kimlik verir;
 * görsel URL'i paylaşılır (kaynak hâlâ referans verdiğinden
 * görsel yaşam döngüsü tarafından silinmez). Hedef markanın
 * kayıt defteri girişi ve tüm proje aynaları güncellenir.
 */
export function copyHighlightToBrandState(
  current: PersistedAppState,
  highlightId: string,
  targetBrandId: string,
): { state: PersistedAppState } | { error: string } {
  const brands = current.brands ?? [];
  const target = brands.find((brand) => brand.id === targetBrandId);
  if (!target) return { error: "Hedef marka bulunamadı." };
  let source: Highlight | undefined;
  for (const brand of brands) {
    source = (brand.highlights ?? []).find(
      (highlight) => highlight.id === highlightId,
    );
    if (source) break;
  }
  if (!source) {
    for (const project of current.projects ?? []) {
      source = (project.brand.highlights ?? []).find(
        (highlight) => highlight.id === highlightId,
      );
      if (source) break;
    }
  }
  if (!source) return { error: "Öne çıkan bulunamadı." };
  const copy: Highlight = {
    id: `highlight-${new Date().toISOString()}-${Math.random().toString(36).slice(2, 8)}`,
    title: source.title,
    imageUrl: source.imageUrl,
  };
  const withHighlight = (brand: Brand): Brand => ({
    ...brand,
    highlights: [...(brand.highlights ?? []), copy],
  });
  const next: PersistedAppState = {
    ...current,
    brands: brands.map((brand) =>
      brand.id === targetBrandId ? withHighlight(brand) : brand,
    ),
    projects: (current.projects ?? []).map((project) =>
      project.brandId === targetBrandId
        ? { ...project, brand: withHighlight(project.brand) }
        : project,
    ),
  };
  const nextState =
    next.activeBrandId === targetBrandId
      ? syncActiveProject({ ...next, brand: withHighlight(next.brand) })
      : next;
  return { state: nextState };
}

/** Planlanan gönderi tipi yardımcısı: kopya akışlarında narrowing. */
export type { ExistingPost, PlannedPost };
