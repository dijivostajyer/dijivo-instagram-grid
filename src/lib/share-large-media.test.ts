import { describe, expect, it, vi } from "vitest";

import type { ShareSnapshotInput } from "./share";
import { MAX_SHARE_IMAGE_BYTES } from "./share";
import { computeGrid } from "./grid";
import { prepareShareInput, type LocalMediaReader } from "./share-client";
import { SupabaseShareStore, type SnapshotRow, type SupabaseShareDriver } from "./supabase-share-store";
import type { Brand, ExistingPost } from "./types";

const OWNER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const TOKEN = "3e1a1c76-7958-4d4f-86c6-2727195fd44c";
const now = () => new Date("2026-10-30T12:00:00.000Z");
const ref = (path: string) => `storage:workspace-media/${path}`;

function png(size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return bytes;
}
function mp4(size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set([0, 0, 0, 12, 0x66, 0x74, 0x79, 0x70]);
  return bytes;
}

function fakeDriver(objects: Record<string, Uint8Array>) {
  const rows = new Map<string, SnapshotRow>();
  const uploads: Array<{ path: string; size: number }> = [];
  const media: Array<{ path: string; size: number }> = [];
  const driver: SupabaseShareDriver = {
    async upload(path, body) { uploads.push({ path, size: body.byteLength }); },
    async uploadMedia(path, body) { media.push({ path, size: body.byteLength }); },
    async remove() {}, async removeMedia() {},
    async insert(row) { rows.set(row.token, row); },
    async find(token) { return rows.get(token) ?? null; },
    async sign(path) { return `https://signed.test/${path}`; },
    async signMedia(path) { return `https://signed-media.test/${path}`; },
    async revoke() {},
    async downloadWorkspaceMedia(path) {
      const bytes = objects[path];
      if (!bytes) throw new Error("workspace-media okuma başarısız: nesne bulunamadı");
      return bytes;
    },
  };
  return { driver, rows, uploads, media };
}

const cell = (id: string, imageUrl: string, extra: Record<string, unknown> = {}) => ({ id, source: "mevcut" as const, imageUrl, position: 0, row: 0, column: 0, pinned: false, ...extra });
const input = (cells: ShareSnapshotInput["cells"], brand: ShareSnapshotInput["brand"] = { name: "Dijivo", username: "dijivo" }): ShareSnapshotInput => ({ brand, cells });

describe("büyük medya ile paylaşım oluşturma (Storage'dan Storage'a)", () => {
  it("eski 20 MB toplam sınırını aşan çok görselli grid paylaşılır; snapshot JSON'unda base64 yoktur", async () => {
    const objects: Record<string, Uint8Array> = {};
    const cells = Array.from({ length: 4 }, (_, index) => {
      const path = `${OWNER}/b1/post-${index}.png`;
      objects[path] = png(9 * 1024 * 1024);
      return cell(`p${index}`, ref(path));
    });
    const { driver, rows, uploads } = fakeDriver(objects);
    const store = new SupabaseShareStore(driver, 30, () => TOKEN, now);
    const snapshot = await store.create(input(cells), { ownerId: OWNER });
    expect(uploads).toHaveLength(4);
    expect(uploads.every((item) => item.size === 9 * 1024 * 1024)).toBe(true);
    expect(snapshot.cells.every((item) => item.imageUrl.startsWith("storage:shares/"))).toBe(true);
    const payload = JSON.stringify(rows.get(TOKEN)?.payload);
    expect(payload).not.toContain("base64");
    expect(payload.length).toBeLessThan(10_000);
  });

  it("50 MB reel videosu workspace-media'dan share-media'ya kopyalanır; kapaksız grid görseli kapakla değişir", async () => {
    const videoPath = `${OWNER}/b1/reel.mp4`;
    const coverPath = `${OWNER}/b1/cover.png`;
    const { driver, media, uploads } = fakeDriver({ [videoPath]: mp4(50 * 1024 * 1024), [coverPath]: png(1024) });
    const store = new SupabaseShareStore(driver, 30, () => TOKEN, now);
    const snapshot = await store.create(input([cell("r1", ref(videoPath), { postType: "reel", mediaType: "video", videoUrl: ref(videoPath), coverImageUrl: ref(coverPath) })]), { ownerId: OWNER });
    expect(media).toHaveLength(1);
    expect(media[0].size).toBe(50 * 1024 * 1024);
    expect(uploads).toHaveLength(1);
    expect(snapshot.cells[0].videoUrl).toMatch(/^storage:media\//);
    expect(snapshot.cells[0].imageUrl).toBe(snapshot.cells[0].coverImageUrl);
  });

  it("öne çıkan görselleri de Storage'a taşınır ve okurken imzalanır", async () => {
    const path = `${OWNER}/b1/h.png`;
    const { driver } = fakeDriver({ [path]: png(2048), [`${OWNER}/b1/p.png`]: png(2048) });
    const store = new SupabaseShareStore(driver, 30, () => TOKEN, now);
    await store.create(input([cell("p", ref(`${OWNER}/b1/p.png`))], { name: "D", username: "d", highlights: [{ id: "h", title: "H", imageUrl: ref(path) }] }), { ownerId: OWNER });
    const read = await store.get(TOKEN);
    expect(read?.brand.highlights?.[0].imageUrl).toMatch(/^https:\/\/signed\.test\/shares\//);
  });

  it("başka kullanıcıya ait veya ownerId'siz referans reddedilir", async () => {
    const path = `${OTHER}/b1/x.png`;
    const { driver, uploads } = fakeDriver({ [path]: png(2048) });
    const store = new SupabaseShareStore(driver, 30, () => TOKEN, now);
    await expect(store.create(input([cell("x", ref(path))]), { ownerId: OWNER })).rejects.toThrow("sahipliği");
    await expect(store.create(input([cell("x", ref(path))]))).rejects.toThrow("sahipliği");
    expect(uploads).toHaveLength(0);
  });

  it("görsel içeriği olmayan nesne ve tek dosya sınırı net hata verir", async () => {
    const bad = `${OWNER}/b1/bad.png`;
    const big = `${OWNER}/b1/big.png`;
    const { driver } = fakeDriver({ [bad]: new Uint8Array(64), [big]: png(MAX_SHARE_IMAGE_BYTES + 1) });
    const store = new SupabaseShareStore(driver, 30, () => TOKEN, now);
    await expect(store.create(input([cell("a", ref(bad))]), { ownerId: OWNER })).rejects.toThrow("Paylaşım görseli geçersiz");
    await expect(store.create(input([cell("a", ref(big))]), { ownerId: OWNER })).rejects.toThrow("çok büyük");
  });
});

describe("istemci: yerel büyük medya gövdeye gömülmez", () => {
  const brand: Brand = { id: "b1", name: "Dijivo", username: "dijivo" };
  const post: ExistingPost = { id: "e1", source: "mevcut", imageUrl: "idb:big", recencyIndex: 0, pinned: false };

  it("yerel medya Storage'a yüklenir; istekte yalnız storage referansı gider", async () => {
    const reader: LocalMediaReader = vi.fn(async () => ({ bytes: png(12 * 1024 * 1024), mime: "image/png" as const }));
    const uploader = vi.fn(async () => ref(`${OWNER}/share/abc.png`));
    const result = await prepareShareInput(brand, computeGrid([post], []), { reader, uploader });
    expect(uploader).toHaveBeenCalledTimes(1);
    expect(result.cells[0].imageUrl).toBe(ref(`${OWNER}/share/abc.png`));
    expect(JSON.stringify(result)).not.toContain("base64");
  });

  it("oturum yoksa (uploader null) eski data URL davranışına düşer", async () => {
    vi.stubGlobal("window", { btoa: (value: string) => Buffer.from(value, "binary").toString("base64") });
    try {
      const reader: LocalMediaReader = async () => ({ bytes: png(16), mime: "image/png" as const });
      const result = await prepareShareInput(brand, computeGrid([post], []), { reader, uploader: async () => null });
      expect(result.cells[0].imageUrl.startsWith("data:image/png;base64,")).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
