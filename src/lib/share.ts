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
export function isShareableImageUrl(value: string): boolean {
  if (value.startsWith("blob:") || value.startsWith("idb:")) return false;
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
export function isShareableVideoUrl(value: string): boolean {
  if (value.startsWith("blob:") || value.startsWith("idb:") || value.startsWith("idb-video:")) return false;
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

function isShareBrand(value: unknown): value is ShareBrand {
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
    (value.profileImageUrl === undefined || isShareableImageUrl(value.profileImageUrl))
  );
}

function isShareGridCell(value: unknown): value is ShareGridCell {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    (value.source === "mevcut" || value.source === "planlanan") &&
    typeof value.imageUrl === "string" &&
    isShareableImageUrl(value.imageUrl) &&
    isOptionalString(value.alt) &&
    typeof value.position === "number" &&
    typeof value.row === "number" &&
    typeof value.column === "number" &&
    typeof value.pinned === "boolean" &&
    (value.postType === undefined || value.postType === "post" || value.postType === "reel" || value.postType === "carousel") &&
    isOptionalString(value.caption) &&
    (value.mediaType === undefined || value.mediaType === "image" || value.mediaType === "video") &&
    (value.videoUrl === undefined || (typeof value.videoUrl === "string" && isShareableVideoUrl(value.videoUrl))) &&
    (value.coverImageUrl === undefined || (typeof value.coverImageUrl === "string" && isShareableImageUrl(value.coverImageUrl)))
  );
}

export function validateShareSnapshotInput(value: unknown): ShareSnapshotInput | null {
  if (!isRecord(value) || !isShareBrand(value.brand) || !Array.isArray(value.cells)) {
    return null;
  }
  const cells: ShareGridCell[] = [];
  for (const cell of value.cells) {
    if (!isShareGridCell(cell)) return null;
    cells.push({ ...cell, postType: cell.postType ?? "post" });
  }
  if (cells.length === 0 || cells.length > MAX_SHARE_CELLS) return null;
  return { brand: { ...value.brand }, cells };
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
      bio: brand.bio,
      profileImageUrl: brand.profileImageUrl,
      postCount: brand.postCount,
      followersCount: brand.followersCount,
      followingCount: brand.followingCount,
      highlights: brand.highlights,
    },
    cells: result.cells.map((cell) => ({
      id: cell.post.id,
      source: cell.post.source,
      imageUrl: cell.post.imageUrl,
      alt: cell.post.alt,
      position: cell.position,
      row: cell.row,
      column: cell.column,
      pinned: cell.pinned,
      postType: cell.post.postType ?? "post",
      caption: cell.post.caption,
      mediaType: cell.post.mediaType,
      videoUrl: cell.post.videoUrl,
      coverImageUrl: cell.post.coverImageUrl,
    })),
  };
}
