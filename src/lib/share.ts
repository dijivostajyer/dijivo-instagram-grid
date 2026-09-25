import type { Brand, GridResult, PostSource } from "./types";
import { isValidShareToken } from "./share-token";

export const SHARE_SNAPSHOT_VERSION = 1;
export const MAX_SHARE_CELLS = 60;
export const MAX_SHARE_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_SHARE_TOTAL_BYTES = 20 * 1024 * 1024;

export interface ShareBrand {
  name: string;
  username: string;
  bio?: string;
  profileImageUrl?: string;
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

function isShareBrand(value: unknown): value is ShareBrand {
  return (
    isRecord(value) &&
    typeof value.name === "string" &&
    typeof value.username === "string" &&
    isOptionalString(value.bio) &&
    isOptionalString(value.profileImageUrl) &&
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
    typeof value.pinned === "boolean"
  );
}

export function validateShareSnapshotInput(value: unknown): ShareSnapshotInput | null {
  if (!isRecord(value) || !isShareBrand(value.brand) || !Array.isArray(value.cells)) {
    return null;
  }
  const cells: ShareGridCell[] = [];
  for (const cell of value.cells) {
    if (!isShareGridCell(cell)) return null;
    cells.push({ ...cell });
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
    })),
  };
}
