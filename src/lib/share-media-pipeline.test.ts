import { describe, expect, it } from "vitest";

import { computeGrid } from "./grid";
import { prepareShareInput, type LocalMediaReader } from "./share-client";
import { assertPortableShareInput, findLocalMediaRefs } from "./share-media";
import type { ShareSnapshotInput } from "./share";
import { SupabaseShareStore, type SnapshotRow, type SupabaseShareDriver } from "./supabase-share-store";
import type { Brand, ExistingPost, PlannedPost } from "./types";

/**
 * Uçtan uca paylaşım hattı:
 *
 *   idb: / idb-video: / blob:
 *     → istemcide bayta çözülür
 *     → private Supabase storage'a yüklenir
 *     → snapshot'ta YALNIZCA storage: referansı kalır
 *
 * Böylece link başka cihazda (IndexedDB olmadan) açılabilir.
 */

const BRAND: Brand = { id: "b1", name: "Dijivo", username: "dijivo" };

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2]);
const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const WEBP_BYTES = (() => {
  const bytes = new Uint8Array(16);
  bytes.set([0x52, 0x49, 0x46, 0x46], 0);
  bytes.set([0x57, 0x45, 0x42, 0x50], 8);
  return bytes;
})();
const WEBM_BYTES = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x01, 0x02]);
const MP4_BYTES = new Uint8Array([0, 0, 0, 12, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32]);

function stubBtoa(): () => void {
  const host = globalThis as unknown as { window?: { btoa: (input: string) => string } };
  const original = host.window;
  host.window = { btoa: (input: string) => Buffer.from(input, "binary").toString("base64") };
  return () => {
    host.window = original;
  };
}

function readerFor(
  map: Record<string, { bytes: Uint8Array; mime: "image/png" | "image/jpeg" | "image/webp" | "video/mp4" | "video/webm" }>,
): LocalMediaReader {
  return async (url) => {
    const entry = map[url];
    return entry ? { bytes: entry.bytes, mime: entry.mime } : null;
  };
}

function fakeDriver(): SupabaseShareDriver & {
  rows: Map<string, SnapshotRow>;
  uploads: string[];
  mediaUploads: string[];
} {
  const rows = new Map<string, SnapshotRow>();
  const uploads: string[] = [];
  const mediaUploads: string[] = [];
  return {
    rows, uploads, mediaUploads,
    async upload(path) { uploads.push(path); },
    async remove() {},
    async uploadMedia(path) { mediaUploads.push(path); },
    async removeMedia() {},
    async insert(row) { rows.set(row.token, row); },
    async find(token) { return rows.get(token) ?? null; },
    async sign(path) { return `https://signed.test/${path}`; },
    async signMedia(path) { return `https://signed-media.test/${path}`; },
    async revoke() {},
  };
}

function store(driver: SupabaseShareDriver) {
  return new SupabaseShareStore(
    driver,
    30,
    () => "3e1a1c76-7958-4d4f-86c6-2727195fd44c",
    () => new Date("2026-10-02T12:00:00.000Z"),
  );
}

describe("paylaşım hattı — idb: görsel → private storage", () => {
  it("PNG/JPG/WebP kalıcı referansları storage'a taşınır, snapshot temiz kalır", async () => {
    const restore = stubBtoa();
    try {
      const posts: PlannedPost[] = [
        { id: "p1", source: "planlanan", imageUrl: "idb:m1", alt: "png", planOrder: 0 },
        { id: "p2", source: "planlanan", imageUrl: "idb:m2", alt: "jpg", planOrder: 1 },
        { id: "p3", source: "planlanan", imageUrl: "idb:m3", alt: "webp", planOrder: 2 },
      ];
      const prepared = await prepareShareInput(BRAND, computeGrid([], posts), {
        reader: readerFor({
          "idb:m1": { bytes: PNG_BYTES, mime: "image/png" },
          "idb:m2": { bytes: JPEG_BYTES, mime: "image/jpeg" },
          "idb:m3": { bytes: WEBP_BYTES, mime: "image/webp" },
        }),
      });
      // İstemci çıktısı zaten taşınabilir.
      expect(findLocalMediaRefs(prepared)).toEqual([]);

      const driver = fakeDriver();
      const snapshot = await store(driver).create(prepared);
      // Üç görsel share-images bucket'ına yüklendi.
      expect(driver.uploads).toHaveLength(3);
      expect(driver.mediaUploads).toHaveLength(0);
      // Snapshot'ta yerel referans YOK.
      expect(findLocalMediaRefs(snapshot)).toEqual([]);
      expect(snapshot.cells.map((cell) => cell.imageUrl)).toEqual([
        expect.stringMatching(/^storage:shares\//),
        expect.stringMatching(/^storage:shares\//),
        expect.stringMatching(/^storage:shares\//),
      ]);
    } finally {
      restore();
    }
  });

  it("okuma sırasında storage: referansları signed URL'e çevrilir", async () => {
    const restore = stubBtoa();
    try {
      const posts: PlannedPost[] = [
        { id: "p1", source: "planlanan", imageUrl: "idb:m1", alt: "png", planOrder: 0 },
      ];
      const prepared = await prepareShareInput(BRAND, computeGrid([], posts), {
        reader: readerFor({ "idb:m1": { bytes: PNG_BYTES, mime: "image/png" } }),
      });
      const shareStore = store(fakeDriver());
      const created = await shareStore.create(prepared);
      const read = await shareStore.get(created.token);
      expect(read?.cells[0].imageUrl).toMatch(/^https:\/\/signed\.test\//);
      expect(findLocalMediaRefs(read)).toEqual([]);
    } finally {
      restore();
    }
  });
});

describe("paylaşım hattı — idb-video: reel → private share-media", () => {
  it("reel kapağı share-images'a, WebM videosu share-media'ya yüklenir", async () => {
    const restore = stubBtoa();
    try {
      const reel: ExistingPost[] = [
        {
          id: "r1", source: "mevcut", imageUrl: "idb-video:v1", alt: "Reel",
          recencyIndex: 0, pinned: false, postType: "reel", mediaType: "video",
          videoUrl: "idb-video:v1", coverImageUrl: "idb:cover",
        },
      ];
      const prepared = await prepareShareInput(BRAND, computeGrid(reel, []), {
        reader: readerFor({
          "idb-video:v1": { bytes: WEBM_BYTES, mime: "video/webm" },
          "idb:cover": { bytes: JPEG_BYTES, mime: "image/jpeg" },
        }),
        posterMaker: async () => null,
      });
      expect(findLocalMediaRefs(prepared)).toEqual([]);

      const driver = fakeDriver();
      const snapshot = await store(driver).create(prepared);
      expect(driver.uploads).toHaveLength(1); // kapak
      expect(driver.mediaUploads).toHaveLength(1); // video
      expect(findLocalMediaRefs(snapshot)).toEqual([]);
      expect(snapshot.cells[0].videoUrl).toMatch(/^storage:media\//);
      expect(snapshot.cells[0].coverImageUrl).toMatch(/^storage:shares\//);
    } finally {
      restore();
    }
  });

  it("kapaksız reelde poster görsele dönüşür, video yine storage'a gider", async () => {
    const restore = stubBtoa();
    try {
      const reel: ExistingPost[] = [
        {
          id: "r1", source: "mevcut", imageUrl: "idb-video:v1", alt: "Reel",
          recencyIndex: 0, pinned: false, postType: "reel", mediaType: "video",
          videoUrl: "idb-video:v1",
        },
      ];
      const prepared = await prepareShareInput(BRAND, computeGrid(reel, []), {
        reader: readerFor({ "idb-video:v1": { bytes: MP4_BYTES, mime: "video/mp4" } }),
        posterMaker: async () => ({ bytes: PNG_BYTES, mime: "image/png" }),
      });
      const driver = fakeDriver();
      const snapshot = await store(driver).create(prepared);
      // Poster görsel bucket'ına, video media bucket'ına.
      expect(driver.uploads).toHaveLength(1);
      expect(driver.mediaUploads).toHaveLength(1);
      expect(snapshot.cells[0].imageUrl).toMatch(/^storage:shares\//);
      expect(snapshot.cells[0].videoUrl).toMatch(/^storage:media\//);
      expect(findLocalMediaRefs(snapshot)).toEqual([]);
    } finally {
      restore();
    }
  });

  it("okuma sırasında video signed URL'e çevrilir (readonly linkte oynatılabilir)", async () => {
    const restore = stubBtoa();
    try {
      const reel: ExistingPost[] = [
        {
          id: "r1", source: "mevcut", imageUrl: "idb-video:v1", alt: "Reel",
          recencyIndex: 0, pinned: false, postType: "reel", mediaType: "video",
          videoUrl: "idb-video:v1", coverImageUrl: "idb:cover",
        },
      ];
      const prepared = await prepareShareInput(BRAND, computeGrid(reel, []), {
        reader: readerFor({
          "idb-video:v1": { bytes: WEBM_BYTES, mime: "video/webm" },
          "idb:cover": { bytes: JPEG_BYTES, mime: "image/jpeg" },
        }),
        posterMaker: async () => null,
      });
      const shareStore = store(fakeDriver());
      const created = await shareStore.create(prepared);
      const read = await shareStore.get(created.token);
      expect(read?.cells[0].videoUrl).toMatch(/^https:\/\/signed-media\.test\//);
      expect(read?.cells[0].coverImageUrl).toMatch(/^https:\/\/signed\.test\//);
    } finally {
      restore();
    }
  });
});

describe("paylaşım hattı — kalıcılık garantisi", () => {
  it("hazırlanmış girdi doğrulamadan geçer", async () => {
    const restore = stubBtoa();
    try {
      const posts: PlannedPost[] = [
        { id: "p1", source: "planlanan", imageUrl: "idb:m1", alt: "a", planOrder: 0 },
      ];
      const prepared = await prepareShareInput(BRAND, computeGrid([], posts), {
        reader: readerFor({ "idb:m1": { bytes: PNG_BYTES, mime: "image/png" } }),
      });
      const asInput: ShareSnapshotInput = prepared;
      expect(() => assertPortableShareInput(asInput)).not.toThrow();
    } finally {
      restore();
    }
  });

  it("çoklu yükleme sonrası tüm hücreler taşınabilir", async () => {
    const restore = stubBtoa();
    try {
      const posts: PlannedPost[] = Array.from({ length: 5 }, (_, index) => ({
        id: `p${index}`,
        source: "planlanan" as const,
        imageUrl: `idb:m${index}`,
        alt: `a${index}`,
        planOrder: index,
      }));
      const prepared = await prepareShareInput(BRAND, computeGrid([], posts), {
        reader: readerFor(
          Object.fromEntries(
            posts.map((post, index) => [
              post.imageUrl,
              { bytes: PNG_BYTES, mime: "image/png" as const },
            ]),
          ),
        ),
      });
      const driver = fakeDriver();
      const snapshot = await store(driver).create(prepared);
      expect(driver.uploads).toHaveLength(5);
      expect(findLocalMediaRefs(snapshot)).toEqual([]);
    } finally {
      restore();
    }
  });
});