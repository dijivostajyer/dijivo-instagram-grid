import { createClient } from "@supabase/supabase-js";

import {
  MAX_SHARE_IMAGE_BYTES,
  MAX_SHARE_TOTAL_BYTES,
  createShareSnapshot,
  deserializeShareSnapshot,
  type ShareSnapshot,
  type ShareSnapshotInput,
} from "./share";
import { getShareStorageConfig, type ShareStorageConfig } from "./share-config";
import { generateShareToken, isValidShareToken } from "./share-token";
import type { ShareStore } from "./share-store";

type SnapshotRow = { token: string; payload: unknown; expires_at: string; revoked_at: string | null };

export interface SupabaseShareDriver {
  upload(path: string, body: Uint8Array, contentType: string): Promise<void>;
  remove(paths: string[]): Promise<void>;
  insert(row: SnapshotRow): Promise<void>;
  find(token: string): Promise<SnapshotRow | null>;
  sign(path: string, seconds: number): Promise<string>;
  revoke(token: string, revokedAt: string): Promise<void>;
}

function dataImage(value: string): { mime: string; bytes: Uint8Array; extension: string } | null {
  const match = /^data:(image\/(jpeg|png|webp));base64,([a-z0-9+/=]+)$/i.exec(value);
  if (!match) return null;
  const bytes = new Uint8Array(Buffer.from(match[3], "base64"));
  return { mime: match[1].toLowerCase(), bytes, extension: match[2] === "jpeg" ? "jpg" : match[2] };
}

function storagePath(token: string, index: number, extension: string): string {
  return `shares/${token}/${index.toString(36)}-${generateShareToken().slice(0, 8)}.${extension}`;
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
      const uploaded: string[] = [];
      try {
        const converted = await this.uploadDataImages(input, token, uploaded);
        const createdAt = this.now();
        const snapshot = createShareSnapshot(converted, token, createdAt.toISOString());
        await this.driver.insert({ token, payload: snapshot, expires_at: addDays(createdAt, this.ttlDays).toISOString(), revoked_at: null });
        return this.resolveStorageImages(snapshot);
      } catch (error) {
        lastError = error;
        if (uploaded.length > 0) {
          try { await this.driver.remove(uploaded); } catch (cleanupError) { console.warn("[share] Orphan görseller temizlenemedi:", cleanupError); }
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

  private async uploadDataImages(input: ShareSnapshotInput, token: string, uploaded: string[]): Promise<ShareSnapshotInput> {
    let total = 0;
    let index = 0;
    const convert = async (url: string): Promise<string> => {
      const image = dataImage(url);
      if (!image) return url;
      if (image.bytes.byteLength > MAX_SHARE_IMAGE_BYTES) throw new Error("Paylaşım için yüklenen görseller çok büyük.");
      total += image.bytes.byteLength;
      if (total > MAX_SHARE_TOTAL_BYTES) throw new Error("Paylaşım için yüklenen görseller çok büyük.");
      const path = storagePath(token, index, image.extension);
      index += 1;
      await this.driver.upload(path, image.bytes, image.mime);
      uploaded.push(path);
      return `storage:${path}`;
    };
    return {
      brand: { ...input.brand, profileImageUrl: input.brand.profileImageUrl ? await convert(input.brand.profileImageUrl) : undefined },
      cells: await Promise.all(input.cells.map(async (cell) => ({ ...cell, imageUrl: await convert(cell.imageUrl) }))),
    };
  }

  private async resolveStorageImages(snapshot: ShareSnapshot): Promise<ShareSnapshot> {
    const resolve = async (url: string): Promise<string> => url.startsWith("storage:") ? this.driver.sign(url.slice(8), 3600) : url;
    return {
      ...snapshot,
      brand: { ...snapshot.brand, profileImageUrl: snapshot.brand.profileImageUrl ? await resolve(snapshot.brand.profileImageUrl) : undefined },
      cells: await Promise.all(snapshot.cells.map(async (cell) => ({ ...cell, imageUrl: await resolve(cell.imageUrl) }))),
    };
  }
}

export function createSupabaseShareDriver(config: ShareStorageConfig = getShareStorageConfig()): SupabaseShareDriver {
  const client = createClient(config.url, config.secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
  return {
    async upload(path, body, contentType) { const { error } = await client.storage.from(config.bucket).upload(path, body, { contentType, upsert: false }); if (error) throw new Error("Storage upload başarısız."); },
    async remove(paths) { const { error } = await client.storage.from(config.bucket).remove(paths); if (error) throw new Error("Storage cleanup başarısız."); },
    async insert(row) { const { error } = await client.from("share_snapshots").insert(row); if (error) throw new Error(error.code === "23505" ? "duplicate token" : "Snapshot insert başarısız."); },
    async find(token) { const { data, error } = await client.from("share_snapshots").select("token,payload,expires_at,revoked_at").eq("token", token).maybeSingle(); if (error) throw new Error("Snapshot okuma başarısız."); return data as SnapshotRow | null; },
    async sign(path, seconds) { const { data, error } = await client.storage.from(config.bucket).createSignedUrl(path, seconds); if (error || !data) throw new Error("Signed URL üretilemedi."); return data.signedUrl; },
    async revoke(token, revokedAt) { const { error } = await client.from("share_snapshots").update({ revoked_at: revokedAt }).eq("token", token); if (error) throw new Error("Snapshot revoke başarısız."); },
  };
}
