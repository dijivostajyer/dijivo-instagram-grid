"use client";

import type { User } from "@supabase/supabase-js";

import { syncActiveProject } from "./brand-ops";
import { getSupabaseBrowserClient } from "./supabase-browser";
import type { GridProject, PersistedAppState } from "./storage";
import type { Brand, ExistingPost, PlannedPost } from "./types";
import { isWorkspaceMediaRef, uploadWorkspaceMedia, workspaceMediaPath } from "./workspace-media-store";

type BrandRow = Record<string, unknown>;
type PostRow = Record<string, unknown>;
const stored = (value: string | undefined) => isWorkspaceMediaRef(value) ? workspaceMediaPath(value) : value ?? null;
const ref = (value: unknown) => typeof value === "string" ? `storage:workspace-media/${value}` : undefined;

async function upload(value: string | undefined, purpose: string) {
  return value ? uploadWorkspaceMedia(value, purpose) : undefined;
}

async function materializeMedia(state: PersistedAppState): Promise<PersistedAppState> {
  const brand = async (item: Brand): Promise<Brand> => ({
    ...item,
    profileImageUrl: await upload(item.profileImageUrl, `${item.id}/profile`),
    highlights: await Promise.all((item.highlights ?? []).map(async (highlight) => ({ ...highlight, imageUrl: await upload(highlight.imageUrl, `${item.id}/highlight`) }))),
  });
  const materializePost = async <T extends ExistingPost | PlannedPost>(item: T, brandId: string): Promise<T> => ({
    ...item, imageUrl: (await upload(item.imageUrl, `${brandId}/post`)) ?? item.imageUrl,
    videoUrl: await upload(item.videoUrl, `${brandId}/video`), coverImageUrl: await upload(item.coverImageUrl, `${brandId}/cover`),
  });
  const brands = await Promise.all((state.brands ?? []).map(brand));
  const projects = await Promise.all((state.projects ?? []).map(async (project) => ({
    ...project, brand: await brand(project.brand), existingPosts: await Promise.all(project.existingPosts.map((item) => materializePost(item, project.brandId ?? project.brand.id))), plannedPosts: await Promise.all(project.plannedPosts.map((item) => materializePost(item, project.brandId ?? project.brand.id))),
  })));
  const activeBrand = brands.find((item) => item.id === state.activeBrandId) ?? state.brand;
  const activeProject = projects.find((item) => item.id === state.activeProjectId);
  return { ...state, brands, projects, brand: activeBrand, existingPosts: activeProject?.existingPosts ?? state.existingPosts, plannedPosts: activeProject?.plannedPosts ?? state.plannedPosts };
}

function mergeBrand(remote: Brand, local: Brand): Brand {
  const preferRemote = <T,>(remoteValue: T | undefined, localValue: T | undefined): T | undefined =>
    remoteValue ?? localValue;
  const remoteHighlights = remote.highlights ?? [];
  const highlightIds = new Set(remoteHighlights.map((highlight) => highlight.id));
  return {
    ...local,
    ...remote,
    displayName: preferRemote(remote.displayName, local.displayName),
    profileImageUrl: preferRemote(remote.profileImageUrl, local.profileImageUrl),
    bio: preferRemote(remote.bio, local.bio), website: preferRemote(remote.website, local.website),
    phone: preferRemote(remote.phone, local.phone), email: preferRemote(remote.email, local.email),
    category: preferRemote(remote.category, local.category),
    postCount: preferRemote(remote.postCount, local.postCount),
    followersCount: preferRemote(remote.followersCount, local.followersCount),
    followingCount: preferRemote(remote.followingCount, local.followingCount),
    hashtagGroups: remote.hashtagGroups?.length ? remote.hashtagGroups : (local.hashtagGroups ?? []),
    defaultMentions: remote.defaultMentions?.length ? remote.defaultMentions : (local.defaultMentions ?? []),
    defaultCtas: remote.defaultCtas?.length ? remote.defaultCtas : (local.defaultCtas ?? []),
    highlights: [...remoteHighlights, ...(local.highlights ?? []).filter((highlight) => !highlightIds.has(highlight.id))],
  };
}

function mergePosts<T extends ExistingPost | PlannedPost>(remote: T[], local: T[]): T[] {
  const ids = new Set(remote.map((post) => post.id));
  return [...remote, ...local.filter((post) => !ids.has(post.id))];
}

/**
 * Entity-level, non-destructive initial reconciliation. Remote records win
 * when the same ID exists; local records missing remotely are retained so a
 * partially migrated workspace (brands/projects present, posts absent) heals
 * itself on the next sync.
 */
export function reconcileWorkspaceState(
  remote: PersistedAppState | null,
  local: PersistedAppState,
): PersistedAppState {
  if (!remote) return local;
  const localBrands = new Map((local.brands ?? []).map((brand) => [brand.id, brand]));
  const brands = (remote.brands ?? []).map((brand) => {
    const localBrand = localBrands.get(brand.id);
    if (localBrand) localBrands.delete(brand.id);
    return localBrand ? mergeBrand(brand, localBrand) : brand;
  });
  brands.push(...localBrands.values());

  const localProjects = new Map((local.projects ?? []).map((project) => [project.id, project]));
  const projects = (remote.projects ?? []).map((project) => {
    const localProject = localProjects.get(project.id);
    if (localProject) localProjects.delete(project.id);
    if (!localProject) return project;
    const brand = brands.find((item) => item.id === project.brandId) ?? project.brand;
    return {
      ...project,
      brand,
      existingPosts: mergePosts(project.existingPosts, localProject.existingPosts),
      plannedPosts: mergePosts(project.plannedPosts, localProject.plannedPosts),
    };
  });
  projects.push(...localProjects.values());

  const activeBrandId = remote.activeBrandId && brands.some((brand) => brand.id === remote.activeBrandId)
    ? remote.activeBrandId : local.activeBrandId;
  const activeProjectId = remote.activeProjectId && projects.some((project) => project.id === remote.activeProjectId)
    ? remote.activeProjectId : local.activeProjectId;
  const activeBrand = brands.find((brand) => brand.id === activeBrandId) ?? brands[0] ?? local.brand;
  const activeProject = projects.find((project) => project.id === activeProjectId);
  return {
    version: 3, brands, projects, activeBrandId, activeProjectId, brand: activeBrand,
    existingPosts: activeProject?.existingPosts ?? local.existingPosts,
    plannedPosts: activeProject?.plannedPosts ?? local.plannedPosts,
  };
}

export async function pullWorkspace(user: User): Promise<PersistedAppState | null> {
  const db = getSupabaseBrowserClient(); if (!db) return null;
  const [brandsResult, projectsResult, postsResult, highlightsResult, prefsResult] = await Promise.all([
    db.from("workspace_brands").select("*").eq("user_id", user.id), db.from("workspace_projects").select("*").eq("user_id", user.id),
    db.from("workspace_posts").select("*").eq("user_id", user.id), db.from("workspace_highlights").select("*").eq("user_id", user.id),
    db.from("workspace_prefs").select("*").eq("user_id", user.id).maybeSingle(),
  ]);
  if (brandsResult.error || projectsResult.error || postsResult.error || highlightsResult.error || prefsResult.error) throw new Error("Workspace okunamadı.");
  const rawBrands = (brandsResult.data ?? []) as BrandRow[];
  if (!rawBrands.length) return null;
  const rawHighlights = (highlightsResult.data ?? []) as BrandRow[];
  const brands: Brand[] = rawBrands.map((row) => ({ id: String(row.id), name: String(row.name), username: String(row.username), displayName: row.display_name as string | undefined, profileImageUrl: ref(row.profile_image_path), bio: row.bio as string | undefined, website: row.website as string | undefined, phone: row.phone as string | undefined, email: row.email as string | undefined, category: row.category as string | undefined, postCount: row.post_count as number | undefined, followersCount: row.followers_count as number | undefined, followingCount: row.following_count as number | undefined, hashtagGroups: (row.hashtag_groups as Brand["hashtagGroups"]) ?? [], defaultMentions: (row.default_mentions as string[]) ?? [], defaultCtas: (row.default_ctas as string[]) ?? [], highlights: rawHighlights.filter((h) => h.brand_id === row.id).map((h) => ({ id: String(h.id), title: String(h.title), imageUrl: ref(h.image_path) })) }));
  const rawPosts = (postsResult.data ?? []) as PostRow[];
  const projects: GridProject[] = ((projectsResult.data ?? []) as BrandRow[]).map((project) => {
    const mapPost = (row: PostRow) => ({ id: String(row.id), source: row.source as "mevcut" | "planlanan", imageUrl: ref(row.image_path) ?? "", alt: row.alt as string | undefined, aspectRatio: row.aspect_ratio as ExistingPost["aspectRatio"], postType: row.post_type as ExistingPost["postType"], caption: row.caption as string | undefined, mediaType: row.media_type as ExistingPost["mediaType"], videoUrl: ref(row.video_path), coverImageUrl: ref(row.cover_path), recencyIndex: row.recency_index as number, planOrder: row.plan_order as number, pinned: Boolean(row.pinned), pinnedOrder: row.pinned_order as number | undefined });
    const posts = rawPosts.filter((post) => post.project_id === project.id);
    return { id: String(project.id), name: String(project.name), month: Number(project.month), year: Number(project.year), createdAt: String(project.created_at), updatedAt: String(project.updated_at), brandId: String(project.brand_id), brand: brands.find((brand) => brand.id === project.brand_id) ?? brands[0], existingPosts: posts.filter((post) => post.source === "mevcut").map(mapPost) as ExistingPost[], plannedPosts: posts.filter((post) => post.source === "planlanan").map(mapPost) as PlannedPost[] };
  });
  const prefs = prefsResult.data as BrandRow | null;
  const activeBrandId = typeof prefs?.active_brand_id === "string" ? prefs.active_brand_id : brands[0].id;
  const activeProjectId = typeof prefs?.active_project_id === "string" ? prefs.active_project_id : (projects.find((p) => p.brandId === activeBrandId)?.id ?? "");
  const active = projects.find((p) => p.id === activeProjectId);
  return { version: 3, brands, activeBrandId, projects, activeProjectId, brand: brands.find((b) => b.id === activeBrandId) ?? brands[0], existingPosts: active?.existingPosts ?? [], plannedPosts: active?.plannedPosts ?? [] };
}

export async function pushWorkspace(user: User, input: PersistedAppState): Promise<PersistedAppState> {
  const db = getSupabaseBrowserClient(); if (!db) throw new Error("Supabase Auth yapılandırılmadı.");
  const state = await materializeMedia(input);
  const brands = state.brands ?? [];
  const brandRows = brands.map((brand) => ({ user_id: user.id, id: brand.id, name: brand.name, username: brand.username, display_name: brand.displayName ?? null, profile_image_path: stored(brand.profileImageUrl), bio: brand.bio ?? null, website: brand.website ?? null, phone: brand.phone ?? null, email: brand.email ?? null, category: brand.category ?? null, post_count: brand.postCount ?? null, followers_count: brand.followersCount ?? null, following_count: brand.followingCount ?? null, hashtag_groups: brand.hashtagGroups ?? [], default_mentions: brand.defaultMentions ?? [], default_ctas: brand.defaultCtas ?? [] }));
  if (brandRows.length) { const { error } = await db.from("workspace_brands").upsert(brandRows, { onConflict: "id" }); if (error) throw error; }
  const projects = state.projects ?? [];
  if (projects.length) { const { error } = await db.from("workspace_projects").upsert(projects.map((p) => ({ user_id: user.id, id: p.id, brand_id: p.brandId ?? p.brand.id, name: p.name, month: p.month, year: p.year, created_at: p.createdAt, updated_at: p.updatedAt })), { onConflict: "id" }); if (error) throw error; }
  const postRows = projects.flatMap((project) => [...project.existingPosts, ...project.plannedPosts].map((post) => ({ user_id: user.id, id: post.id, brand_id: project.brandId ?? project.brand.id, project_id: project.id, source: post.source, image_path: stored(post.imageUrl), alt: post.alt ?? null, aspect_ratio: post.aspectRatio ?? null, post_type: post.postType ?? null, caption: post.caption ?? null, recency_index: post.source === "mevcut" ? post.recencyIndex : null, plan_order: post.source === "planlanan" ? post.planOrder : null, pinned: post.source === "mevcut" ? post.pinned : false, pinned_order: post.source === "mevcut" ? post.pinnedOrder ?? null : null, media_type: post.mediaType ?? null, video_path: stored(post.videoUrl), cover_path: stored(post.coverImageUrl) })));
  if (postRows.length) { const { error } = await db.from("workspace_posts").upsert(postRows, { onConflict: "id" }); if (error) throw error; }
  const highlights = brands.flatMap((brand) => (brand.highlights ?? []).map((highlight) => ({ user_id: user.id, id: highlight.id, brand_id: brand.id, title: highlight.title, image_path: stored(highlight.imageUrl) })));
  if (highlights.length) { const { error } = await db.from("workspace_highlights").upsert(highlights, { onConflict: "id" }); if (error) throw error; }
  const { error } = await db.from("workspace_prefs").upsert({ user_id: user.id, active_brand_id: state.activeBrandId || null, active_project_id: state.activeProjectId || null }); if (error) throw error;
  return syncActiveProject(state);
}
