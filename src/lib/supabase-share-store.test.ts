import { describe, expect, it } from "vitest";

import type { ShareSnapshotInput } from "./share";
import { getShareStorageConfig } from "./share-config";
import { SupabaseShareStore, type SnapshotRow, type SupabaseShareDriver } from "./supabase-share-store";
import { SHARE_SNAPSHOT_VERSION } from "./share";
import { InMemoryShareStore, getShareStore } from "./share-store";

const TOKEN = "3e1a1c76-7958-4d4f-86c6-2727195fd44c";
const now = () => new Date("2026-09-25T12:00:00.000Z");
const PNG = "iVBORw0KGgo=";
const JPEG = "/9j/";
/** Geçerli MP4: byte 4-8'de `ftyp` kutusu başlığı. */
const MP4 = Buffer.from([0, 0, 0, 12, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32]).toString("base64");
/** Geçerli WebM: EBML başlığı 1A 45 DF A3. */
const WEBM = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x01, 0x00, 0x00, 0x00]).toString("base64");
const input = (): ShareSnapshotInput => ({ brand: { name: "Dijivo", username: "dijivo" }, cells: [{ id: "a", source: "mevcut", imageUrl: `data:image/png;base64,${PNG}`, position: 0, row: 0, column: 0, pinned: false }] });
/** Reel girdisi: grid görseli + kapak (share-images) + video (share-media). */
const reelInput = (): ShareSnapshotInput => ({
  brand: { name: "Dijivo", username: "dijivo" },
  cells: [{
    id: "reel-1", source: "mevcut",
    imageUrl: `data:image/png;base64,${PNG}`,
    alt: "Reel", position: 0, row: 0, column: 0, pinned: false,
    postType: "reel", caption: "Reel caption",
    mediaType: "video",
    videoUrl: `data:video/mp4;base64,${MP4}`,
    coverImageUrl: `data:image/jpeg;base64,${JPEG}`,
  }],
});

function fakeDriver(): SupabaseShareDriver & {
  rows: Map<string, SnapshotRow>;
  uploads: string[];
  removed: string[];
  mediaUploads: string[];
  mediaRemoved: string[];
} {
  const rows = new Map<string, SnapshotRow>();
  const uploads: string[] = []; const removed: string[] = [];
  const mediaUploads: string[] = []; const mediaRemoved: string[] = [];
  return {
    rows, uploads, removed, mediaUploads, mediaRemoved,
    async upload(path) { uploads.push(path); }, async remove(paths) { removed.push(...paths); },
    async uploadMedia(path) { mediaUploads.push(path); }, async removeMedia(paths) { mediaRemoved.push(...paths); },
    async insert(row) { if (rows.has(row.token)) throw new Error("duplicate token"); rows.set(row.token, row); },
    async find(token) { return rows.get(token) ?? null; }, async sign(path) { return `https://signed.test/${path}`; },
    async signMedia(path) { return `https://signed-media.test/${path}`; },
    async revoke(token, revokedAt) { const row = rows.get(token); if (row) row.revoked_at = revokedAt; },
  };
}

describe("SupabaseShareStore", () => {
  it("data URL'i private storage path'e taşır ve signed URL ile okur", async () => {
    const driver = fakeDriver(); const store = new SupabaseShareStore(driver, 30, () => TOKEN, now);
    const created = await store.create(input());
    expect(driver.uploads).toHaveLength(1);
    expect(driver.rows.get(TOKEN)?.version).toBe(SHARE_SNAPSHOT_VERSION);
    expect(driver.rows.get(TOKEN)?.created_at).toBe(created.createdAt);
    expect((driver.rows.get(TOKEN)?.payload as { version: number }).version).toBe(driver.rows.get(TOKEN)?.version);
    expect(JSON.stringify(driver.rows.get(TOKEN)?.payload)).not.toContain("data:image");
    expect(created.cells[0].imageUrl).toContain("storage:shares/");
    expect((await store.get(TOKEN))?.cells[0].imageUrl).toContain("https://signed.test/shares/");
  });

  it("expired veya revoked snapshot'ı döndürmez", async () => {
    const driver = fakeDriver(); const store = new SupabaseShareStore(driver, 1, () => TOKEN, now);
    await store.create(input()); await store.revoke(TOKEN);
    await expect(store.get(TOKEN)).resolves.toBeNull();
  });

  it("upload sonrası DB insert başarısızsa orphan dosyaları temizler", async () => {
    const driver = fakeDriver(); driver.insert = async () => { throw new Error("insert failed"); };
    const store = new SupabaseShareStore(driver, 30, () => TOKEN, now);
    await expect(store.create(input())).rejects.toThrow("insert failed");
    expect(driver.removed).toEqual(driver.uploads);
  });

  it("geçersiz binary veya MIME eşleşmesini reddeder", async () => {
    const store = new SupabaseShareStore(fakeDriver(), 30, () => TOKEN, now);
    await expect(store.create({ ...input(), cells: [{ ...input().cells[0], imageUrl: "data:image/png;base64,aGk=" }] })).rejects.toThrow();
    await expect(store.create({ ...input(), cells: [{ ...input().cells[0], imageUrl: `data:image/jpeg;base64,${PNG}` }] })).rejects.toThrow();
    await expect(store.create({ ...input(), cells: [{ ...input().cells[0], imageUrl: `data:image/jpeg;base64,${JPEG}` }] })).resolves.toBeTruthy();
  });

  it("sıralı upload hata sonrası başlatılmamış görsel bırakmaz", async () => {
    const driver = fakeDriver(); let count = 0; let inserted = false;
    driver.upload = async (path) => { count += 1; if (count === 2) throw new Error("upload failed"); driver.uploads.push(path); };
    driver.insert = async () => { inserted = true; };
    const cells = [0, 1, 2].map((position) => ({ ...input().cells[0], id: String(position), position, column: position, imageUrl: `data:image/png;base64,${PNG}` }));
    await expect(new SupabaseShareStore(driver, 30, () => TOKEN, now).create({ ...input(), cells })).rejects.toThrow("upload failed");
    expect(count).toBe(2); expect(driver.removed).toEqual(driver.uploads); expect(inserted).toBe(false);
  });

  it("reel videosu private share-media bucket'ına yükler; signed video URL ile okur (§9/§13/§22)", async () => {
    const driver = fakeDriver();
    const store = new SupabaseShareStore(driver, 30, () => TOKEN, now);
    const created = await store.create(reelInput());
    expect(driver.mediaUploads).toHaveLength(1);
    expect(driver.mediaUploads[0]).toMatch(/^media\/[0-9a-f-]+\/0-[a-z0-9-]+\.mp4$/);
    // Kapak + grid görseli image pipeline'ından (share-images) yüklenir (§14).
    expect(driver.uploads).toHaveLength(2);
    expect(driver.uploads.every((path) => path.startsWith("shares/"))).toBe(true);
    expect(created.cells[0].videoUrl).toContain("storage:media/");
    expect(created.cells[0].coverImageUrl).toContain("storage:shares/");
    const fetched = await store.get(TOKEN);
    expect(fetched?.cells[0].videoUrl).toContain("https://signed-media.test/media/");
    expect(fetched?.cells[0].coverImageUrl).toContain("https://signed.test/shares/");
    expect(fetched?.cells[0].caption).toBe("Reel caption");
    expect(fetched?.cells[0].mediaType).toBe("video");
    expect(fetched?.cells[0].postType).toBe("reel");
  });

  it("geçersiz video binary/MIME eşleşmesini reddeder (§22)", async () => {
    const store = new SupabaseShareStore(fakeDriver(), 30, () => TOKEN, now);
    // MP4 MIME'siyle WebM magic byte
    await expect(store.create({ ...reelInput(), cells: [{ ...reelInput().cells[0], videoUrl: `data:video/mp4;base64,${WEBM}` }] })).rejects.toThrow();
    // WebM MIME'siyle MP4 magic byte
    await expect(store.create({ ...reelInput(), cells: [{ ...reelInput().cells[0], videoUrl: `data:video/webm;base64,${MP4}` }] })).rejects.toThrow();
    // Geçerli WebM kabul edilir
    await expect(store.create({ ...reelInput(), cells: [{ ...reelInput().cells[0], videoUrl: `data:video/webm;base64,${WEBM}` }] })).resolves.toBeTruthy();
  });

  it("yarım upload (görsel başarılı, video fail) senaryosunda her iki bucket'tan da temizler (§10/§15/§22)", async () => {
    const driver = fakeDriver();
    let mediaAttempts = 0;
    driver.uploadMedia = async (path) => {
      mediaAttempts += 1;
      if (mediaAttempts === 2) throw new Error("video upload failed");
      driver.mediaUploads.push(path);
    };
    const cells = [
      { ...input().cells[0], id: "img-1", position: 0, column: 0 },
      { ...input().cells[0], id: "img-2", position: 1, row: 0, column: 1 },
      { ...reelInput().cells[0], id: "reel-ok", position: 2, row: 0, column: 2 },
      { ...reelInput().cells[0], id: "reel-fail", position: 3, row: 1, column: 0 },
    ];
    const store = new SupabaseShareStore(driver, 30, () => TOKEN, now);
    await expect(store.create({ brand: { name: "Dijivo", username: "dijivo" }, cells })).rejects.toThrow("video upload failed");
    // 4 başarılı görsel (2 normal + reel-ok kapak + reel-ok grid görseli) share-images'ten temizlenir.
    expect(driver.uploads).toHaveLength(4);
    // reel-ok videosu share-media'dan temizlenir; yarım snapshot bırakılmaz.
    expect(driver.mediaUploads).toHaveLength(1);
    expect(driver.removed).toEqual(driver.uploads);
    expect(driver.mediaRemoved).toEqual(driver.mediaUploads);
    expect(driver.rows.size).toBe(0);
  });

  it("revoke sonrası reel video yeniden imzalanmaz / erişilemez (§16/§22)", async () => {
    const driver = fakeDriver();
    let mediaSigns = 0;
    const originalSignMedia = driver.signMedia;
    driver.signMedia = async (path, seconds) => {
      mediaSigns += 1;
      return originalSignMedia(path, seconds);
    };
    const store = new SupabaseShareStore(driver, 30, () => TOKEN, now);
    await store.create(reelInput());
    // Revoke öncesi video signed URL ile çözülür.
    expect((await store.get(TOKEN))?.cells[0].videoUrl).toContain("https://signed-media.test/");
    expect(mediaSigns).toBe(1);
    await store.revoke(TOKEN);
    await expect(store.get(TOKEN)).resolves.toBeNull();
    // Revoke sonrası yeni signed video URL üretilmez.
    expect(mediaSigns).toBe(1);
  });

  it("create signed URL başarısız olsa da başarılı kalır; get imzalamada hata verir", async () => {
    const driver = fakeDriver(); driver.sign = async () => { throw new Error("sign failed"); };
    const store = new SupabaseShareStore(driver, 30, () => TOKEN, now);
    await expect(store.create(input())).resolves.toBeTruthy();
    await expect(store.get(TOKEN)).rejects.toThrow("sign failed");
  });

  it("production eksik env'de memory fallback yapmaz", () => {
    expect(() => getShareStorageConfig({ NODE_ENV: "production" })).toThrow("Supabase paylaşım storage yapılandırması eksik.");
  });
  it("API alt yolu içeren Supabase URL'ini reddeder", () => {
    expect(() => getShareStorageConfig({ NODE_ENV: "test", SUPABASE_URL: "https://x.supabase.co/rest/v1", SUPABASE_SECRET_KEY: "test" })).toThrow("proje kök URL");
  });
});

describe("getShareStore seçimi", () => {
  it("credential varsa development ve production'da Supabase seçer", () => {
    const env = { SUPABASE_URL: "https://example.supabase.co", SUPABASE_SECRET_KEY: "test-key" };
    expect(getShareStore({ ...env, NODE_ENV: "development" }).constructor.name).toBe("SupabaseShareStore");
    expect(getShareStore({ ...env, NODE_ENV: "production" }).constructor.name).toBe("SupabaseShareStore");
  });
  it("credential yoksa development memory, production hata verir", () => {
    expect(getShareStore({ NODE_ENV: "development" })).toBeInstanceOf(InMemoryShareStore);
    expect(() => getShareStore({ NODE_ENV: "production" })).toThrow("Supabase paylaşım storage yapılandırması eksik.");
  });
});
