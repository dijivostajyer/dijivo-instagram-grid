import { describe, expect, it } from "vitest";

import {
  assertPortableShareInput,
  collectLocalMediaSlots,
  detectImageMime,
  detectVideoMime,
  findLocalMediaRefs,
  imageExtension,
  isLocalMediaRef,
  isReelVideoAsImage,
  videoExtension,
} from "./share-media";
import type { ShareSnapshotInput } from "./share";

function pngBytes(): Uint8Array {
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
}
function jpegBytes(): Uint8Array {
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2]);
}
function webpBytes(): Uint8Array {
  const bytes = new Uint8Array(16);
  bytes.set([0x52, 0x49, 0x46, 0x46], 0);
  bytes.set([0x57, 0x45, 0x42, 0x50], 8);
  return bytes;
}
function webmBytes(): Uint8Array {
  return new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3]);
}
function mp4Bytes(): Uint8Array {
  const bytes = new Uint8Array(16);
  bytes.set([0x66, 0x74, 0x79, 0x70], 4);
  return bytes;
}

function cell(overrides: Partial<ShareSnapshotInput["cells"][number]> = {}) {
  return {
    id: "mevcut-1",
    source: "mevcut" as const,
    imageUrl: "https://cdn.example.com/a.png",
    position: 0,
    row: 0,
    column: 0,
    pinned: false,
    postType: "post" as const,
    ...overrides,
  };
}

function input(cells: ShareSnapshotInput["cells"]): ShareSnapshotInput {
  return { brand: { name: "Dijivo", username: "dijivo" }, cells };
}

describe("share-media — yerel referans tespiti", () => {
  it("idb:, idb-video: ve blob: yerel referanstır", () => {
    expect(isLocalMediaRef("idb:abc")).toBe(true);
    expect(isLocalMediaRef("idb-video:abc")).toBe(true);
    expect(isLocalMediaRef("blob:http://localhost/x")).toBe(true);
  });

  it("data:, storage: ve https: taşınabilirdir", () => {
    expect(isLocalMediaRef("data:image/png;base64,AA")).toBe(false);
    expect(isLocalMediaRef("storage:shares/tok/0-a.png")).toBe(false);
    expect(isLocalMediaRef("https://cdn.example.com/a.png")).toBe(false);
  });
});

describe("share-media — magic byte algılama", () => {
  it("PNG, JPG ve WebP görselleri tanır", () => {
    expect(detectImageMime(pngBytes())).toBe("image/png");
    expect(detectImageMime(jpegBytes())).toBe("image/jpeg");
    expect(detectImageMime(webpBytes())).toBe("image/webp");
  });

  it("MP4 ve WebM videoları tanır", () => {
    expect(detectVideoMime(mp4Bytes())).toBe("video/mp4");
    expect(detectVideoMime(webmBytes())).toBe("video/webm");
  });

  it("tanınmayan baytları reddeder", () => {
    expect(detectImageMime(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]))).toBeNull();
    expect(detectVideoMime(new Uint8Array([9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9]))).toBeNull();
    expect(detectImageMime(new Uint8Array([1]))).toBeNull();
  });

  it("uzantı eşlemesi doğru", () => {
    expect(imageExtension("image/jpeg")).toBe("jpg");
    expect(imageExtension("image/png")).toBe("png");
    expect(imageExtension("image/webp")).toBe("webp");
    expect(videoExtension("video/mp4")).toBe("mp4");
    expect(videoExtension("video/webm")).toBe("webm");
  });
});

describe("share-media — yerel yuva toplama", () => {
  it("idb: görsel, idb-video: video ve blob: kapak yuvasını toplar", () => {
    const snapshot = input([
      cell({
        imageUrl: "idb:img-1",
        mediaType: "video",
        videoUrl: "idb-video:vid-1",
        coverImageUrl: "blob:http://localhost/cover",
      }),
    ]);
    const slots = collectLocalMediaSlots(snapshot);
    expect(slots.map((slot) => `${slot.path}:${slot.kind}`)).toEqual([
      "cells.0.imageUrl:image",
      "cells.0.coverImageUrl:image",
      "cells.0.videoUrl:video",
    ]);
  });

  it("profil ve highlight görsellerini de kapsar", () => {
    const snapshot: ShareSnapshotInput = {
      brand: {
        name: "Dijivo",
        username: "dijivo",
        profileImageUrl: "idb:profile",
        highlights: [{ id: "h1", title: "H", imageUrl: "idb:h1" }],
      },
      cells: [cell()],
    };
    const paths = collectLocalMediaSlots(snapshot).map((slot) => slot.path);
    expect(paths).toContain("brand.profileImageUrl");
    expect(paths).toContain("brand.highlights.0.imageUrl");
  });

  it("taşınabilir girdide yerel yuva bulmaz", () => {
    const snapshot = input([
      cell({ imageUrl: "https://cdn.example.com/a.png", videoUrl: "storage:media/t/0-a.mp4" }),
    ]);
    expect(collectLocalMediaSlots(snapshot)).toEqual([]);
  });
});

describe("share-media — snapshot taşınabilirliği", () => {
  it("hazırlanmış snapshot yerel referans içermez", () => {
    const snapshot = {
      brand: { name: "Dijivo", username: "dijivo", profileImageUrl: "storage:shares/tok/0-a.png" },
      cells: [cell({ imageUrl: "storage:shares/tok/1-b.webp", videoUrl: "storage:media/tok/0-c.webm" })],
    };
    expect(findLocalMediaRefs(snapshot)).toEqual([]);
    expect(() => assertPortableShareInput(snapshot as never)).not.toThrow();
  });

  it("idb: referansı kalmışsa hata fırlatır ve yolu listeler", () => {
    const snapshot = input([cell({ imageUrl: "idb:img-1" })]);
    const leftover = findLocalMediaRefs(snapshot);
    expect(leftover).toHaveLength(1);
    expect(leftover[0]).toContain("cells[0].imageUrl");
    expect(() => assertPortableShareInput(snapshot)).toThrowError(
      /çözülemeyen yerel medya kaldı/,
    );
  });

  it("idb-video: ve blob: referanslarını da yakalar", () => {
    const snapshot = input([
      cell({ imageUrl: "blob:http://localhost/a", videoUrl: "idb-video:v" }),
    ]);
    expect(findLocalMediaRefs(snapshot)).toHaveLength(2);
  });
});

describe("share-media — kapaksız reel tespiti", () => {
  it("mediaType video + yerel görsel referansı = kapaksız reel", () => {
    expect(isReelVideoAsImage(cell({ mediaType: "video", imageUrl: "idb-video:v" }))).toBe(true);
    expect(isReelVideoAsImage(cell({ mediaType: "video", imageUrl: "storage:media/t/0-a.mp4" }))).toBe(false);
    expect(isReelVideoAsImage(cell({ imageUrl: "idb:i" }))).toBe(false);
  });
});