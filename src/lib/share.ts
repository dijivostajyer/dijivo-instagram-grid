import type { Brand, GridResult, PostSource, PostType, Highlight } from "./types";
import { isValidShareToken } from "./share-token";

export const SHARE_SNAPSHOT_VERSION = 1;
export const MAX_SHARE_CELLS = 60;
export const MAX_SHARE_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_SHARE_TOTAL_BYTES = 20 * 1024 * 1024;
/** Phase 2 (§5/§9): reel video boyut sınırı (dosya başına). */
export const MAX_SHARE_VIDEO_BYTES = 100 * 1024 * 1024;
/** Phase 2 (§5/§9): paylaşım başına toplam video sınırı. */
export const MAX_SHARE_TOTAL_VIDEO_BYTES = 200 * 1024 * 1024;

export interface ShareBrand {
  name: string;
  username: string;
  bio?: string;
  profileImageUrl?: string;
  postCount?: number;
  followersCount?: number;
  followingCount?: number;
  highlights?: Highlight[];
}

export interface ShareGridCell {
  id: string;
  source: PostSource;
  imageUrl: string;
  alt?: string;
  position: number;
  row: number;
  column: number;
  pinned: boolean;
  postType?: PostType;
  /** Gönderi açıklaması (Phase 2, §3); eski paylaşımlarda yok olabilir. */
  caption?: string;
  /** Medya türü (Phase 2, §4); tanımsız = görsel gönderi. */
  mediaType?: "image" | "video";
  /** Reel videosu için paylaşılabilir URL (data URL veya storage referansı). */
  videoUrl?: string;
  /** Reel kapak görseli URL'si (grid'de video yerine gösterilir). */
  coverImageUrl?: string;
}

export interface ShareSnapshotInput {
  brand: ShareBrand;
  cells: ShareGridCell[];
}

export interface ShareSnapshot extends ShareSnapshotInput {
  version: number;
  token: string;
  createdAt: string;
}

export class ShareSnapshotError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}

/** Yalnızca başka tarayıcıda da çözülebilen görsel URL'leri kabul edilir. */
export function isWorkspaceMediaShareRef(value: string): boolean {
  return /^storage:workspace-media\/[0-9a-f-]{36}\/.+/i.test(value);
}

export function isShareableImageUrl(value: string, allowWorkspaceMedia = false): boolean {
  if (value.startsWith("blob:") || value.startsWith("idb:")) return false;
  if (allowWorkspaceMedia && isWorkspaceMediaShareRef(value)) return true;
  if (/^storage:shares\/[0-9a-f-]+\/[a-z0-9-]+\.(?:jpg|png|webp)$/i.test(value)) return true;
  if (/^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(value)) {
    return true;
  }
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

/**
 * Yalnızca taşınabilir reel video URL'leri kabul edilir
 * (Phase 2, §4/§9): data URL (mp4/webm), private share-media
 * storage referansı (`storage:media/…`) veya doğrudan http(s)
 * akışı. blob:/idb:/idb-video: referansları reddedilir.
 */
export function isShareableVideoUrl(value: string, allowWorkspaceMedia = false): boolean {
  if (value.startsWith("blob:") || value.startsWith("idb:") || value.startsWith("idb-video:")) return false;
  if (allowWorkspaceMedia && isWorkspaceMediaShareRef(value)) return true;
  if (/^storage:media\/[0-9a-f-]+\/[a-z0-9-]+\.(?:mp4|webm)$/i.test(value)) return true;
  if (/^data:video\/(?:mp4|webm);base64,[a-z0-9+/=]+$/i.test(value)) {
    return true;
  }
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function isShareBrand(value: unknown, allowWorkspaceMedia: boolean): value is ShareBrand {
  return (
    isRecord(value) &&
    typeof value.name === "string" &&
    typeof value.username === "string" &&
    isOptionalString(value.bio) &&
    isOptionalString(value.profileImageUrl) &&
    (value.postCount === undefined || typeof value.postCount === "number") &&
    (value.followersCount === undefined || typeof value.followersCount === "number") &&
    (value.followingCount === undefined || typeof value.followingCount === "number") &&
    (value.highlights === undefined || (Array.isArray(value.highlights) && value.highlights.every((highlight) => isRecord(highlight) && typeof highlight.id === "string" && typeof highlight.title === "string" && isOptionalString(highlight.imageUrl)))) &&
    (value.profileImageUrl === undefined || isShareableImageUrl(value.profileImageUrl, allowWorkspaceMedia))
  );
}

function isShareGridCell(value: unknown, allowWorkspaceMedia: boolean): value is ShareGridCell {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    (value.source === "mevcut" || value.source === "planlanan") &&
    typeof value.imageUrl === "string" &&
    isShareableImageUrl(value.imageUrl, allowWorkspaceMedia) &&
    isOptionalString(value.alt) &&
    typeof value.position === "number" &&
    typeof value.row === "number" &&
    typeof value.column === "number" &&
    typeof value.pinned === "boolean" &&
    (value.postType === undefined || value.postType === "post" || value.postType === "reel" || value.postType === "carousel") &&
    isOptionalString(value.caption) &&
    (value.mediaType === undefined || value.mediaType === "image" || value.mediaType === "video") &&
    (value.videoUrl === undefined || (typeof value.videoUrl === "string" && isShareableVideoUrl(value.videoUrl, allowWorkspaceMedia))) &&
    (value.coverImageUrl === undefined || (typeof value.coverImageUrl === "string" && isShareableImageUrl(value.coverImageUrl, allowWorkspaceMedia)))
  );
}

function validateShareInput(value: unknown, allowWorkspaceMedia: boolean): ShareSnapshotInput | null {
  if (!isRecord(value) || !isShareBrand(value.brand, allowWorkspaceMedia) || !Array.isArray(value.cells)) {
    return null;
  }
  const cells: ShareGridCell[] = [];
  for (const cell of value.cells) {
    if (!isShareGridCell(cell, allowWorkspaceMedia)) return null;
    cells.push({ ...cell, postType: cell.postType ?? "post" });
  }
  if (cells.length === 0 || cells.length > MAX_SHARE_CELLS) return null;
  return { brand: { ...value.brand }, cells };
}

/** İstemciden gelen taslak, server kopyalamadan önce workspace-media ref içerebilir. */
export function validateShareCreateInput(value: unknown): ShareSnapshotInput | null {
  return validateShareInput(value, true);
}

/** Snapshot'a yalnız taşınabilir share URL'leri/data URL'leri yazılabilir. */
export function validateShareSnapshotInput(value: unknown): ShareSnapshotInput | null {
  return validateShareInput(value, false);
}

/** Gizli veri/medya baytı yazmadan validation'ın ilk başarısız alanını raporlar. */
export function describeInvalidShareInput(value: unknown): string {
  if (!isRecord(value)) return "payload object değil";
  if (!isRecord(value.brand)) return "brand object değil";
  if (typeof value.brand.name !== "string") return "brand.name string değil";
  if (typeof value.brand.username !== "string") return "brand.username string değil";
  for (const field of ["bio", "profileImageUrl"] as const) {
    if (!isOptionalString(value.brand[field])) return `brand.${field} string|undefined değil`;
  }
  for (const field of ["postCount", "followersCount", "followingCount"] as const) {
    if (value.brand[field] !== undefined && typeof value.brand[field] !== "number") return `brand.${field} number|undefined değil`;
  }
  if (!Array.isArray(value.cells)) return "cells array değil";
  if (value.cells.length === 0 || value.cells.length > MAX_SHARE_CELLS) return "cells sayısı geçersiz";
  for (let index = 0; index < value.cells.length; index += 1) {
    const cell = value.cells[index];
    if (!isRecord(cell)) return `cells[${index}] object değil`;
    for (const field of ["id", "imageUrl"] as const) if (typeof cell[field] !== "string") return `cells[${index}].${field} string değil`;
    if (cell.source !== "mevcut" && cell.source !== "planlanan") return `cells[${index}].source geçersiz`;
    for (const field of ["position", "row", "column"] as const) if (typeof cell[field] !== "number") return `cells[${index}].${field} number değil`;
    if (typeof cell.pinned !== "boolean") return `cells[${index}].pinned boolean değil`;
    for (const field of ["alt", "caption", "videoUrl", "coverImageUrl"] as const) if (!isOptionalString(cell[field])) return `cells[${index}].${field} string|undefined değil`;
    if (cell.mediaType !== undefined && cell.mediaType !== "image" && cell.mediaType !== "video") return `cells[${index}].mediaType geçersiz`;
  }
  return "görsel/video URL şeması veya highlight alanı geçersiz";
}

export function createShareSnapshot(
  input: ShareSnapshotInput,
  token: string,
  createdAt: string,
): ShareSnapshot {
  const validated = validateShareSnapshotInput(input);
  if (!validated) throw new ShareSnapshotError("Paylaşılabilir grid bulunamadı.");
  if (!isValidShareToken(token) || Number.isNaN(Date.parse(createdAt))) {
    throw new ShareSnapshotError("Paylaşım kaydı geçersiz.");
  }
  return {
    version: SHARE_SNAPSHOT_VERSION,
    token,
    createdAt,
    brand: validated.brand,
    cells: validated.cells,
  };
}

export function serializeShareSnapshot(snapshot: ShareSnapshot): string {
  return JSON.stringify(snapshot);
}

/** Bozuk, eski sürümlü veya güvenli olmayan snapshot'ları reddeder. */
export function deserializeShareSnapshot(json: string | null | undefined): ShareSnapshot | null {
  if (!json) return null;
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return null;
  }
  if (!isRecord(value) || value.version !== SHARE_SNAPSHOT_VERSION) return null;
  if (typeof value.token !== "string" || !isValidShareToken(value.token)) return null;
  if (typeof value.createdAt !== "string" || Number.isNaN(Date.parse(value.createdAt))) {
    return null;
  }
  const input = validateShareSnapshotInput(value);
  if (!input) return null;
  return {
    version: SHARE_SNAPSHOT_VERSION,
    token: value.token,
    createdAt: value.createdAt,
    brand: input.brand,
    cells: input.cells,
  };
}

/** Editörde görülen, hesaplanmış grid sırasını snapshot girdisine dönüştürür. */
export function shareInputFromGrid(brand: Brand, result: GridResult): ShareSnapshotInput {
  return {
    brand: {
      name: brand.name,
      username: brand.username,
      bio: typeof brand.bio === "string" ? brand.bio : undefined,
      profileImageUrl: brand.profileImageUrl,
      postCount: typeof brand.postCount === "number" ? brand.postCount : undefined,
      followersCount: typeof brand.followersCount === "number" ? brand.followersCount : undefined,
      followingCount: typeof brand.followingCount === "number" ? brand.followingCount : undefined,
      highlights: brand.highlights?.map((highlight) => ({ ...highlight, imageUrl: typeof highlight.imageUrl === "string" ? highlight.imageUrl : undefined })),
    },
    cells: result.cells.map((cell) => ({
      id: cell.post.id,
      source: cell.post.source,
      imageUrl: cell.post.imageUrl,
      alt: typeof cell.post.alt === "string" ? cell.post.alt : undefined,
      position: cell.position,
      row: cell.row,
      column: cell.column,
      pinned: cell.pinned,
      postType: cell.post.postType ?? "post",
      caption: typeof cell.post.caption === "string" ? cell.post.caption : undefined,
      mediaType: cell.post.mediaType === "image" || cell.post.mediaType === "video" ? cell.post.mediaType : undefined,
      videoUrl: typeof cell.post.videoUrl === "string" ? cell.post.videoUrl : undefined,
      coverImageUrl: typeof cell.post.coverImageUrl === "string" ? cell.post.coverImageUrl : undefined,
    })),
  };
}
