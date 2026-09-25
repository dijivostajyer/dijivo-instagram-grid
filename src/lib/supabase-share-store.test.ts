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
const input = (): ShareSnapshotInput => ({ brand: { name: "Dijivo", username: "dijivo" }, cells: [{ id: "a", source: "mevcut", imageUrl: `data:image/png;base64,${PNG}`, position: 0, row: 0, column: 0, pinned: false }] });

function fakeDriver(): SupabaseShareDriver & { rows: Map<string, SnapshotRow>; uploads: string[]; removed: string[] } {
  const rows = new Map<string, SnapshotRow>();
  const uploads: string[] = []; const removed: string[] = [];
  return { rows, uploads, removed,
    async upload(path) { uploads.push(path); }, async remove(paths) { removed.push(...paths); },
    async insert(row) { if (rows.has(row.token)) throw new Error("duplicate token"); rows.set(row.token, row); },
    async find(token) { return rows.get(token) ?? null; }, async sign(path) { return `https://signed.test/${path}`; },
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
