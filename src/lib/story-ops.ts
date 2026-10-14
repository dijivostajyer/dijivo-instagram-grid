import type { GridProject, PersistedAppState } from "./storage";
import type { Story } from "./types";

/**
 * Ay (proje) bazlı Story durum geçişleri. Story'ler yalnız
 * `projects[].stories` içinde yaşar; marka verisi etkilenmez.
 * Fonksiyonlar saftır; yan etkiler (Storage/DB) hook katmanındadır.
 */

export function createStoryId(): string {
  return `story-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function sortStories(stories: readonly Story[] | undefined): Story[] {
  return [...(stories ?? [])].sort((left, right) => left.sortOrder - right.sortOrder);
}

function mapProject(
  state: PersistedAppState,
  projectId: string,
  update: (project: GridProject) => GridProject,
): PersistedAppState | null {
  const projects = state.projects ?? [];
  if (!projects.some((project) => project.id === projectId)) return null;
  return {
    ...state,
    projects: projects.map((project) => (project.id === projectId ? update(project) : project)),
  };
}

/** Story'yi yalnız verilen projenin sonuna ekler. */
export function addStoryToProject(
  state: PersistedAppState,
  projectId: string,
  story: Omit<Story, "sortOrder">,
): PersistedAppState | null {
  return mapProject(state, projectId, (project) => {
    const stories = sortStories(project.stories);
    return {
      ...project,
      stories: [...stories, { ...story, sortOrder: stories.length }],
      updatedAt: new Date().toISOString(),
    };
  });
}

/** Yalnız verilen projedeki tek Story'yi siler; sırayı yeniden numaralar. */
export function removeStoryFromProject(
  state: PersistedAppState,
  projectId: string,
  storyId: string,
): PersistedAppState | null {
  return mapProject(state, projectId, (project) => ({
    ...project,
    stories: sortStories(project.stories)
      .filter((story) => story.id !== storyId)
      .map((story, index) => ({ ...story, sortOrder: index })),
    updatedAt: new Date().toISOString(),
  }));
}

/** Kopyalanan Story'nin medyasını kendi Storage nesnesiyle değiştirir. */
export function replaceStoryMedia(
  state: PersistedAppState,
  projectId: string,
  storyId: string,
  mediaUrl: string,
): PersistedAppState | null {
  const project = (state.projects ?? []).find((item) => item.id === projectId);
  if (!project?.stories?.some((story) => story.id === storyId)) return null;
  return mapProject(state, projectId, (current) => ({
    ...current,
    stories: (current.stories ?? []).map((story) => (story.id === storyId ? { ...story, mediaUrl } : story)),
  }));
}

/**
 * Bir medya referansı, durumdaki herhangi bir projede başka bir Story
 * tarafından hâlâ kullanılıyor mu? Storage nesnesi yalnız kimse
 * kullanmıyorsa silinir (paylaşılan path'li eski kopyalar için güvence).
 */
export function isStoryMediaReferenced(
  state: PersistedAppState,
  mediaRef: string,
  toRef: (value: string) => string | undefined,
): boolean {
  return (state.projects ?? []).some((project) =>
    (project.stories ?? []).some((story) => toRef(story.mediaUrl) === mediaRef),
  );
}
