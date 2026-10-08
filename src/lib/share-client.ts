"use client";

/**
 * Paylaşım öncesi medya hazırlığı (§ share fix).
 *
 * Grid'deki `blob:` / `idb:` / `idb-video:` referanslarının **tamamı**
 * byte'a çözülür ve taşınabilir `data:` URL'e dönüştürülür. Böylece:
 *
 * - normal yükleme, çoklu yükleme, reel kapak ve reel video paylaşılır,
 * - kapaksız reel'lerde grid görseli video referansı olduğu için videodan
 *   poster karesi üretilir (aksi halde "Yüklenen görsel paylaşım için
 *   desteklenmiyor" hatası veriyordu),
 * - snapshot içinde yerel referans kalmaz → link başka cihazda açılır.
 *
 * Tüm dış bağımlılıklar (fetch, IndexedDB okuma, poster üretimi)
 * enjekte edilebilir; saf mantık `share-media.ts`'te test edilir.
 */

import {
  detectImageMime,
  detectVideoMime,
  imageExtension,
  videoExtension,
  type ShareImageMime,
  type ShareVideoMime,
} from "./share-media";
import {
  shareInputFromGrid,
  type ShareSnapshotInput,
} from "./share";
import type { Brand, GridResult } from "./types";
import { isWorkspaceMediaRef, workspaceMediaRefFromSignedUrl } from "./workspace-media-store";

export interface ResolvedMedia {
  bytes: Uint8Array;
  mime: ShareImageMime | ShareVideoMime;
}

/** Yerel referansı bayta çözer. Bulunamazsa `null` döner. */
export type LocalMediaReader = (url: string) => Promise<ResolvedMedia | null>;

/** Videodan poster karesi üretir; üretilemezse `null` döner. */
export type PosterMaker = (
  bytes: Uint8Array,
  mime: ShareVideoMime,
) => Promise<ResolvedMedia | null>;

export class ShareMediaPrepareError extends Error {}

function base64FromBytes(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return window.btoa(binary);
}

function toDataUrl(media: ResolvedMedia): string {
  return `data:${media.mime};base64,${base64FromBytes(media.bytes)}`;
}

function isLocal(url: string): boolean {
  return (
    url.startsWith("blob:") ||
    url.startsWith("idb:") ||
    url.startsWith("idb-video:")
  );
}

function isWorkspaceMediaUrl(url: string): boolean {
  return url.startsWith("storage:workspace-media/") || url.includes("/storage/v1/object/sign/workspace-media/");
}

/**
 * Tarayıcı varsayılan okuyucu: `blob:` fetch ile, `idb:` /
 * `idb-video:` IndexedDB'den okunur. MIME tipi içerik baytlarından
 * belirlenir (Blob `type` alanı bozuk olabilir).
 */
export function createBrowserMediaReader(
  fetchImage: typeof fetch = fetch,
  readIndexedDb: (url: string) => Promise<Blob | null> = defaultIndexedDbReader,
): LocalMediaReader {
  return async (url) => {
    let blob: Blob | null = null;
    if (url.startsWith("blob:") || /^https?:/i.test(url)) {
      const response = await fetchImage(url);
      if (!response.ok) throw new ShareMediaPrepareError("Yüklenen medya okunamadı.");
      blob = await response.blob();
    } else {
      blob = await readIndexedDb(url);
      if (blob === null) {
        throw new ShareMediaPrepareError(
          "Yüklenen medya bu tarayıcıda bulunamadı; kalıcı depo bozulmuş olabilir.",
        );
      }
    }
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const imageMime = detectImageMime(bytes);
    if (imageMime) return { bytes, mime: imageMime };
    const videoMime = detectVideoMime(bytes);
    if (videoMime) return { bytes, mime: videoMime };
    throw new ShareMediaPrepareError(
      "Yüklenen medya paylaşım için desteklenmiyor (PNG/JPG/WebP veya MP4/WebM olmalı).",
    );
  };
}

/** `idb:` / `idb-video:` → IndexedDB Blob. */
async function defaultIndexedDbReader(url: string): Promise<Blob | null> {
  const { loadImageAsObjectUrl, isImageRef } = await import("./image-store");
  const { loadVideoAsObjectUrl, isVideoRef } = await import("./video-store");
  const objectUrl = isVideoRef(url)
    ? await loadVideoAsObjectUrl(url)
    : isImageRef(url)
      ? await loadImageAsObjectUrl(url)
      : null;
  if (objectUrl === null) return null;
  try {
    const response = await fetch(objectUrl);
    return response.ok ? await response.blob() : null;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/**
 * Tarayıcı varsayılan poster üreticisi: `<video>` + `<canvas>` ile
 * videonun ilk okunabilir karesini JPEG olarak döndürür. Kare
 * alınamazsa `null` döner (çağıran taraf anlaşılır hata verir).
 */
export function createBrowserPosterMaker(): PosterMaker {
  return (bytes, mime) =>
    new Promise<ResolvedMedia | null>((resolve) => {
      if (typeof document === "undefined") {
        resolve(null);
        return;
      }
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
      const video = document.createElement("video");
      video.muted = true;
      video.playsInline = true;
      video.preload = "auto";
      video.src = url;
      const cleanup = () => {
        video.removeAttribute("src");
        video.load();
        URL.revokeObjectURL(url);
      };
      const timeout = window.setTimeout(() => {
        cleanup();
        resolve(null);
      }, 8000);
      video.onerror = () => {
        window.clearTimeout(timeout);
        cleanup();
        resolve(null);
      };
      video.onseeked = () => {
        window.clearTimeout(timeout);
        try {
          const canvas = document.createElement("canvas");
          const width = video.videoWidth || 320;
          const height = video.videoHeight || 320;
          canvas.width = width;
          canvas.height = height;
          const context = canvas.getContext("2d");
          if (!context) throw new Error("2D bağlamı yok");
          context.drawImage(video, 0, 0, width, height);
          const dataUrl = canvas.toDataURL("image/jpeg", 0.82);
          cleanup();
          const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
          const binary = window.atob(base64);
          const out = new Uint8Array(binary.length);
          for (let index = 0; index < binary.length; index += 1) {
            out[index] = binary.charCodeAt(index);
          }
          resolve({ bytes: out, mime: "image/jpeg" });
        } catch {
          cleanup();
          resolve(null);
        }
      };
      video.onloadeddata = () => {
        // İlk kareye git; `onseeked` poster'ı üretir.
        video.currentTime = Math.min(0.1, (video.duration || 1) / 2);
      };
    });
}

/**
 * Yerel medya referanslarını taşınabilir `data:` URL'lere çevirir.
 * Kapaksız reel'lerde grid görseli video baytlarına işaret edebilir;
 * bu durumda **kapak varsa kapak**, yoksa videodan üretilen poster
 * kullanılır.
 */
export async function prepareShareInput(
  brand: Brand,
  result: GridResult,
  options: {
    fetchImage?: typeof fetch;
    reader?: LocalMediaReader;
    posterMaker?: PosterMaker;
  } = {},
): Promise<ShareSnapshotInput> {
  const fetchImage = options.fetchImage ?? fetch;
  const reader = options.reader ?? createBrowserMediaReader(fetchImage);
  const posterMaker = options.posterMaker ?? createBrowserPosterMaker();

  /**
   * Yerel referansı data URL'e çevirir; yerel değilse dokunmaz.
   * `fallbackImage` görsel yuvasına video düştüğünde kullanılır
   * (kapak zaten çözülmüşse poster üretmeye gerek kalmaz).
   */
  const materialize = async (
    url: string | undefined,
    kind: "image" | "video",
    fallbackImage?: string,
  ): Promise<string | undefined> => {
    if (url === undefined) return url;
    // Cross-device media is already private Storage content. Keep only its
    // compact reference in the request; the server verifies ownership and
    // copies it into the public share snapshot pipeline.
    const workspaceRef = isWorkspaceMediaRef(url) ? url : workspaceMediaRefFromSignedUrl(url);
    if (workspaceRef) return workspaceRef;
    const source = url;
    if (!isLocal(source) && !isWorkspaceMediaUrl(source)) return source;
    const media = await reader(source);
    if (media === null) {
      throw new ShareMediaPrepareError("Yüklenen medya okunamadı.");
    }
    // Görsel yuvasına video düşmüşse: kapak → poster sırası.
    if (kind === "image" && media.mime.startsWith("video/")) {
      if (fallbackImage !== undefined) return fallbackImage;
      const poster = await posterMaker(media.bytes, media.mime as ShareVideoMime);
      if (poster === null) {
        throw new ShareMediaPrepareError(
          "Reel için kapak görseli paylaşımda oluşturulamadı; gönderiye bir kapak yükleyin.",
        );
      }
      return toDataUrl(poster);
    }
    return toDataUrl(media);
  };

  const input = shareInputFromGrid(brand, result);
  return {
    brand: {
      ...input.brand,
      profileImageUrl: await materialize(input.brand.profileImageUrl, "image"),
      highlights: await Promise.all(
        (input.brand.highlights ?? []).map(async (highlight) => ({
          ...highlight,
          imageUrl: await materialize(highlight.imageUrl, "image"),
        })),
      ),
    },
    cells: await Promise.all(
      input.cells.map(async (cell) => {
        const coverImageUrl = await materialize(cell.coverImageUrl, "image");
        return {
          ...cell,
          // `imageUrl` hücrede zorunludur. Kapak varsa ve grid görseli
          // video referansıysa kapak taşınabilir URL olarak kullanılır.
          imageUrl:
            (await materialize(cell.imageUrl, "image", coverImageUrl)) ??
            cell.imageUrl,
          videoUrl: await materialize(cell.videoUrl, "video"),
          coverImageUrl,
        };
      }),
    ),
  };
}

/** Test/harness yardımcısı: uzantı eşlemesini dışa açar. */
export { imageExtension, videoExtension };
