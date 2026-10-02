import { createClient } from "@supabase/supabase-js";

import {
  MAX_SHARE_IMAGE_BYTES,
  MAX_SHARE_TOTAL_BYTES,
  MAX_SHARE_TOTAL_VIDEO_BYTES,
  MAX_SHARE_VIDEO_BYTES,
  createShareSnapshot,
  deserializeShareSnapshot,
  type ShareSnapshot,
  type ShareSnapshotInput,
} from "./share";
import { getShareStorageConfig, type ShareStorageConfig } from "./share-config";
import { generateShareToken, isValidShareToken } from "./share-token";
import type { ShareStore } from "./share-store";

export type SnapshotRow = { token: string; version: number; created_at: string; payload: unknown; expires_at: string; revoked_at: string | null };

export interface SupabaseShareDriver {
  /** share-images bucket'ına görsel yükler. */
  upload(path: string, body: Uint8Array, contentType: string): Promise<void>;
  /** share-media (private) bucket'ına reel videosu yükler (§9). */
  uploadMedia(path: string, body: Uint8Array, contentType: string): Promise<void>;
  /** share-images bucket'ından görselleri siler. */
  remove(paths: string[]): Promise<void>;
  /** share-media bucket'ından videoları siler (§10 cleanup). */
  removeMedia(paths: string[]): Promise<void>;
  insert(row: SnapshotRow): Promise<void>;
  find(token: string): Promise<SnapshotRow | null>;
  /** share-images bucket'ında signed URL üretir. */
  sign(path: string, seconds: number): Promise<string>;
  /** share-media bucket'ında signed URL üretir (§9). */
  signMedia(path: string, seconds: number): Promise<string>;
  revoke(token: string, revokedAt: string): Promise<void>;
}

function dataImage(value: string): { mime: string; bytes: Uint8Array; extension: string } | null {
  const match = /^data:(image\/(jpeg|png|webp));base64,([a-z0-9+/=]+)$/i.exec(value);
  if (!match) return null;
  const bytes = new Uint8Array(Buffer.from(match[3], "base64"));
  const png = bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, index) => bytes[index] === byte);
  const jpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const webp = bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
  if ((match[2] === "png" && !png) || (match[2] === "jpeg" && !jpeg) || (match[2] === "webp" && !webp)) return null;
  return { mime: match[1].toLowerCase(), bytes, extension: match[2] === "jpeg" ? "jpg" : match[2] };
}

/** MP4: `ftyp` kutusu başlığı byte 4-8'de; WebM: EBML başlığı 1A 45 DF A3. */
function dataVideo(value: string): { mime: string; bytes: Uint8Array; extension: string } | null {
  const match = /^data:video\/(mp4|webm);base64,([a-z0-9+/=]+)$/i.exec(value);
  if (!match) return null;
  const bytes = new Uint8Array(Buffer.from(match[2], "base64"));
  const mp4 = bytes.length >= 12 && bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70;
  const webm = bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3;
  if ((match[1] === "mp4" && !mp4) || (match[1] === "webm" && !webm)) return null;
  return { mime: `video/${match[1].toLowerCase()}`, bytes, extension: match[1].toLowerCase() };
}

function storagePath(token: string, index: number, extension: string): string {
  return `shares/${token}/${index.toString(36)}-${generateShareToken().slice(0, 8)}.${extension}`;
}

/** Reel videoları ayrı private share-media bucket'ında `media/` ön ekiyle yaşar (§9). */
function mediaStoragePath(token: string, index: number, extension: string): string {
  return `media/${token}/${index.toString(36)}-${generateShareToken().slice(0, 8)}.${extension}`;
}

function addDays(now: Date, days: number): Date {
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
}

export class SupabaseShareStore implements ShareStore {
  constructor(
    private readonly driver: SupabaseShareDriver,
    private readonly ttlDays: number,
    private readonly createToken: () => string = generateShareToken,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async create(input: ShareSnapshotInput): Promise<ShareSnapshot> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const token = this.createToken();
      const uploadedImages: string[] = [];
      const uploadedMedia: string[] = [];
      try {
        const converted = await this.uploadDataMedia(input, token, uploadedImages, uploadedMedia);
        const createdAt = this.now();
        const snapshot = createShareSnapshot(converted, token, createdAt.toISOString());
        await this.driver.insert({ token, version: snapshot.version, created_at: snapshot.createdAt, payload: snapshot, expires_at: addDays(createdAt, this.ttlDays).toISOString(), revoked_at: null });
        return snapshot;
      } catch (error) {
        lastError = error;
        // §10: yarım share bırakılmaz — hem görsel hem video objeleri temizlenir.
        if (uploadedImages.length > 0) {
          try { await this.driver.remove(uploadedImages); } catch (cleanupError) { console.warn("[share] Orphan görseller temizlenemedi:", cleanupError); }
        }
        if (uploadedMedia.length > 0) {
          try { await this.driver.removeMedia(uploadedMedia); } catch (cleanupError) { console.warn("[share] Orphan videolar temizlenemedi:", cleanupError); }
        }
        if (!(error instanceof Error) || !error.message.includes("duplicate")) break;
      }
    }
    throw lastError instanceof Error ? lastError : new Error("Paylaşım kaydedilemedi.");
  }

  async get(token: string): Promise<ShareSnapshot | null> {
    if (!isValidShareToken(token)) return null;
    const row = await this.driver.find(token);
    if (!row || row.revoked_at || Date.parse(row.expires_at) <= this.now().getTime()) return null;
    const snapshot = deserializeShareSnapshot(JSON.stringify(row.payload));
    return snapshot ? this.resolveStorageImages(snapshot) : null;
  }

  async revoke(token: string): Promise<void> {
    if (!isValidShareToken(token)) return;
    await this.driver.revoke(token, this.now().toISOString());
  }

  /**
   * Data URL görselleri share-images, reel videoları ise
   * share-media (private) bucket'ına yüklenir (§9/§10).
   * Yükseklik sıralı çalışır; hata anına kadar yüklenen
   * path'ler `uploadedImages`/`uploadedMedia` toplanır.
   */
  private async uploadDataMedia(
    input: ShareSnapshotInput,
    token: string,
    uploadedImages: string[],
    uploadedMedia: string[],
  ): Promise<ShareSnapshotInput> {
    let totalImages = 0;
    let totalVideos = 0;
    let imageIndex = 0;
    let mediaIndex = 0;
    const convertImage = async (url: string): Promise<string> => {
      const image = dataImage(url);
      if (url.startsWith("data:image/") && !image) throw new Error("Paylaşım görseli geçersiz.");
      if (!image) return url;
      if (image.bytes.byteLength > MAX_SHARE_IMAGE_BYTES) throw new Error("Paylaşım için yüklenen görseller çok büyük.");
      totalImages += image.bytes.byteLength;
      if (totalImages > MAX_SHARE_TOTAL_BYTES) throw new Error("Paylaşım için yüklenen görseller çok büyük.");
      const path = storagePath(token, imageIndex, image.extension);
      imageIndex += 1;
      await this.driver.upload(path, image.bytes, image.mime);
      uploadedImages.push(path);
      return `storage:${path}`;
    };
    const convertVideo = async (url: string): Promise<string> => {
      const video = dataVideo(url);
      if (url.startsWith("data:video/") && !video) throw new Error("Paylaşım videosu geçersiz.");
      if (!video) return url;
      if (video.bytes.byteLength > MAX_SHARE_VIDEO_BYTES) throw new Error("Paylaşım için yüklenen videolar çok büyük.");
      totalVideos += video.bytes.byteLength;
      if (totalVideos > MAX_SHARE_TOTAL_VIDEO_BYTES) throw new Error("Paylaşım için yüklenen videolar çok büyük.");
      const path = mediaStoragePath(token, mediaIndex, video.extension);
      mediaIndex += 1;
      await this.driver.uploadMedia(path, video.bytes, video.mime);
      uploadedMedia.push(path);
      return `storage:${path}`;
    };
    const cells = [];
    for (const cell of input.cells) {
      const videoUrl = cell.videoUrl ? await convertVideo(cell.videoUrl) : undefined;
      const coverImageUrl = cell.coverImageUrl ? await convertImage(cell.coverImageUrl) : undefined;
      cells.push({ ...cell, imageUrl: await convertImage(cell.imageUrl), videoUrl, coverImageUrl });
    }
    return {
      brand: {
        ...input.brand,
        profileImageUrl: input.brand.profileImageUrl ? await convertImage(input.brand.profileImageUrl) : undefined,
      },
      cells,
    };
  }

  /**
   * `storage:` referanslarını bucket'larına göre signed URL'e
   * çevirir: görseller share-images, videolar share-media (§9).
   */
  private async resolveStorageImages(snapshot: ShareSnapshot): Promise<ShareSnapshot> {
    const resolveImage = async (url: string): Promise<string> =>
      url.startsWith("storage:") ? this.driver.sign(url.slice(8), 3600) : url;
    const resolveVideo = async (url: string | undefined): Promise<string | undefined> =>
      url === undefined ? undefined : url.startsWith("storage:media/") ? this.driver.signMedia(url.slice(8), 3600) : url;
    return {
      ...snapshot,
      brand: { ...snapshot.brand, profileImageUrl: snapshot.brand.profileImageUrl ? await resolveImage(snapshot.brand.profileImageUrl) : undefined },
      cells: await Promise.all(snapshot.cells.map(async (cell) => ({
        ...cell,
        imageUrl: await resolveImage(cell.imageUrl),
        videoUrl: await resolveVideo(cell.videoUrl),
        coverImageUrl: cell.coverImageUrl === undefined ? undefined : await resolveImage(cell.coverImageUrl),
      }))),
    };
  }
}

export function createSupabaseShareDriver(config: ShareStorageConfig = getShareStorageConfig()): SupabaseShareDriver {
  const client = createClient(config.url, config.secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
  return {
    async upload(path, body, contentType) { const { error } = await client.storage.from(config.bucket).upload(path, body, { contentType, upsert: false }); if (error) throw new Error("Storage upload başarısız."); },
    async uploadMedia(path, body, contentType) { const { error } = await client.storage.from(config.mediaBucket).upload(path, body, { contentType, upsert: false }); if (error) throw new Error("Storage video upload başarısız."); },
    async remove(paths) { const { error } = await client.storage.from(config.bucket).remove(paths); if (error) throw new Error("Storage cleanup başarısız."); },
    async removeMedia(paths) { const { error } = await client.storage.from(config.mediaBucket).remove(paths); if (error) throw new Error("Storage video cleanup başarısız."); },
    async insert(row) { const { error } = await client.from("share_snapshots").insert(row); if (error) throw new Error(error.code === "23505" ? "duplicate token" : "Snapshot insert başarısız."); },
    async find(token) { const { data, error } = await client.from("share_snapshots").select("token,version,created_at,payload,expires_at,revoked_at").eq("token", token).maybeSingle(); if (error) throw new Error("Snapshot okuma başarısız."); return data as SnapshotRow | null; },
    async sign(path, seconds) { const { data, error } = await client.storage.from(config.bucket).createSignedUrl(path, seconds); if (error || !data) throw new Error("Signed URL üretilemedi."); return data.signedUrl; },
    async signMedia(path, seconds) { const { data, error } = await client.storage.from(config.mediaBucket).createSignedUrl(path, seconds); if (error || !data) throw new Error("Video signed URL üretilemedi."); return data.signedUrl; },
    async revoke(token, revokedAt) { const { error } = await client.from("share_snapshots").update({ revoked_at: revokedAt }).eq("token", token); if (error) throw new Error("Snapshot revoke başarısız."); },
  };
}
