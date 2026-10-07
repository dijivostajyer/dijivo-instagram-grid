/**
 * Paylaşım medya taşınabilirliği (§ share fix).
 *
 * Grid'deki görseller/video üç kaynaktan gelir:
 *
 * - `blob:`  — çalışma anındaki object URL (hydration sonrası),
 * - `idb:`   — kalıcı görsel referansı (`dijivo-image-store`),
 * - `idb-video:` — kalıcı video referansı (`dijivo-video-store`).
 *
 * Bunların hiçbiri başka cihazda çözülemez. Paylaşım snapshot'ına
 * `blob:`/`idb:`/`idb-video:` referansı **kalıcı olarak yazılmamalı**;
 * sunucu bunları byte olarak alıp private storage'a yükler ve snapshot'a
 * yalnızca `storage:` referansı yazar.
 *
 * Bu modül tarayıcı API'sine bağımlı değildir; saf eşleme/doğrulama
 * mantığını içerir (test edilebilirlik için).
 */

import type { ShareSnapshotInput } from "./share";

/** Snapshot'ta asla bulunmaması gereken yerel referans önekleri. */
export const LOCAL_MEDIA_PREFIXES = ["blob:", "idb:", "idb-video:"] as const;

/** Değerin yalnızca bu cihazda çözülebilen yerel bir referans mı? */
export function isLocalMediaRef(value: string): boolean {
  return LOCAL_MEDIA_PREFIXES.some((prefix) => value.startsWith(prefix));
}

export type ShareImageMime = "image/jpeg" | "image/png" | "image/webp";
export type ShareVideoMime = "video/mp4" | "video/webm";

const EXTENSION_BY_IMAGE_MIME: Record<ShareImageMime, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

const EXTENSION_BY_VIDEO_MIME: Record<ShareVideoMime, string> = {
  "video/mp4": "mp4",
  "video/webm": "webm",
};

export function imageExtension(mime: ShareImageMime): string {
  return EXTENSION_BY_IMAGE_MIME[mime];
}

export function videoExtension(mime: ShareVideoMime): string {
  return EXTENSION_BY_VIDEO_MIME[mime];
}

function matches(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

/** JPEG: `FF D8 FF`. */
function isJpeg(bytes: Uint8Array): boolean {
  return matches(bytes, [0xff, 0xd8, 0xff]);
}

/** WebP: `RIFF....WEBP` (12 bayt). */
function isWebp(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;
  const riff = String.fromCharCode(...bytes.subarray(0, 4));
  const webp = String.fromCharCode(...bytes.subarray(8, 12));
  return riff === "RIFF" && webp === "WEBP";
}

/** Baytlardan görsel MIME tipini belirler; desteklenmiyorsa `null`. */
export function detectImageMime(bytes: Uint8Array): ShareImageMime | null {
  if (matches(bytes, PNG_SIGNATURE)) return "image/png";
  if (isJpeg(bytes)) return "image/jpeg";
  if (isWebp(bytes)) return "image/webp";
  return null;
}

/** MP4: `ftyp` kutusu 4-8'de. WebM: EBML başlığı `1A 45 DF A3`. */
export function detectVideoMime(bytes: Uint8Array): ShareVideoMime | null {
  const mp4 =
    bytes.length >= 12 &&
    bytes[4] === 0x66 &&
    bytes[5] === 0x74 &&
    bytes[6] === 0x79 &&
    bytes[7] === 0x70;
  if (mp4) return "video/mp4";
  if (matches(bytes, [0x1a, 0x45, 0xdf, 0xa3])) return "video/webm";
  return null;
}

export type ShareMediaKind = "image" | "video";

export interface ShareMediaSlot {
  /** `brand.profileImageUrl`, `brand.highlights.0.imageUrl` veya `cells.3.videoUrl` gibi yol. */
  path: string;
  kind: ShareMediaKind;
  url: string;
}

/**
 * Bir snapshot girdisindeki tüm medya yuvalarını, yalnızca yerel
 * referansları içerenleri döndürür. Storage'a yüklenecek medya
 * kümesi budur; `http(s)`/`data:`/`storage:` yolları atlanır.
 */
export function collectLocalMediaSlots(input: ShareSnapshotInput): ShareMediaSlot[] {
  const slots: ShareMediaSlot[] = [];
  const push = (path: string, kind: ShareMediaKind, url: string | undefined) => {
    if (url !== undefined && isLocalMediaRef(url)) slots.push({ path, kind, url });
  };
  push("brand.profileImageUrl", "image", input.brand.profileImageUrl);
  (input.brand.highlights ?? []).forEach((highlight, index) => {
    push(`brand.highlights.${index}.imageUrl`, "image", highlight.imageUrl);
  });
  input.cells.forEach((cell, index) => {
    push(`cells.${index}.imageUrl`, "image", cell.imageUrl);
    push(`cells.${index}.coverImageUrl`, "image", cell.coverImageUrl);
    push(`cells.${index}.videoUrl`, "video", cell.videoUrl);
  });
  return slots;
}

/**
 * Snapshot JSON'unda kalan yerel referansları döndürür. **Boş dizi
 * dönmeli** — aksi halde paylaşım linki başka cihazda bozuk açılır.
 */
export function findLocalMediaRefs(snapshot: unknown): string[] {
  const found: string[] = [];
  const walk = (value: unknown, path: string) => {
    if (typeof value === "string") {
      if (isLocalMediaRef(value)) found.push(`${path}=${value.slice(0, 24)}`);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((entry, index) => walk(entry, `${path}[${index}]`));
      return;
    }
    if (value !== null && typeof value === "object") {
      for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
        walk(entry, `${path}.${key}`);
      }
    }
  };
  walk(snapshot, "$");
  return found;
}

export class ShareMediaError extends Error {}

/**
 * Sunucuya gönderilecek girdide yerel referans kalmadığını doğrular.
 * Kalan her referansı tek tek listeleyen Türkçe hata üretir.
 */
export function assertPortableShareInput(input: ShareSnapshotInput): void {
  const leftover = findLocalMediaRefs(input);
  if (leftover.length === 0) return;
  throw new ShareMediaError(
    `Paylaşım için çözülemeyen yerel medya kaldı: ${leftover.join(", ")}`,
  );
}

/**
 * Reel gönderisinin grid görseli video referansı olabilir (kapak
 * yüklenmemişse). Bu durumda görsel yuvası video baytlarına işaret
 * eder; paylaşımda görsel yerine kapak kullanılmalıdır.
 */
export function isReelVideoAsImage(cell: ShareSnapshotInput["cells"][number]): boolean {
  return cell.mediaType === "video" && isLocalMediaRef(cell.imageUrl);
}