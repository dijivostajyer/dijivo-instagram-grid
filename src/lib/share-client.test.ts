import { afterEach, describe, expect, it, vi } from "vitest";

import { computeGrid } from "./grid";
import { prepareShareInput, type LocalMediaReader } from "./share-client";
import { assertPortableShareInput, findLocalMediaRefs } from "./share-media";
import type { Brand, ExistingPost, PlannedPost } from "./types";

const BRAND: Brand = {
  id: "brand-1",
  name: "Dijivo",
  username: "dijivo",
  bio: "Grid sunumu",
  postCount: 89,
  followersCount: 1234,
  followingCount: 567,
  profileImageUrl: "https://example.com/profile.jpg",
  highlights: [
    { id: "h1", title: "Kampanya", imageUrl: "https://example.com/highlight.png" },
  ],
};

const EXISTING: ExistingPost[] = [
  {
    id: "e1",
    source: "mevcut",
    imageUrl: "https://example.com/post-1.jpg",
    alt: "Gönderi 1",
    recencyIndex: 0,
    pinned: true,
    pinnedOrder: 0,
  },
];

const PLANNED: PlannedPost[] = [
  {
    id: "p1",
    source: "planlanan",
    imageUrl: "https://example.com/plan-1.jpg",
    alt: "Plan 1",
    planOrder: 0,
  },
];

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const WEBP = (() => {
  const bytes = new Uint8Array(16);
  bytes.set([0x52, 0x49, 0x46, 0x46], 0);
  bytes.set([0x57, 0x45, 0x42, 0x50], 8);
  return bytes;
})();
const MP4 = new Uint8Array([0, 0, 0, 12, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32]);
const WEBM = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x01, 0x02]);

/** Node ortamında `window.btoa` yok; testlerde taklit edilir. */
function stubBtoa(): () => void {
  const host = globalThis as unknown as {
    window?: { btoa: (input: string) => string };
  };
  const original = host.window;
  host.window = {
    btoa: (input: string) => Buffer.from(input, "binary").toString("base64"),
  };
  return () => {
    host.window = original;
  };
}

function readerFor(map: Record<string, { bytes: Uint8Array; mime: "image/png" | "image/jpeg" | "image/webp" | "video/mp4" | "video/webm" }>): LocalMediaReader {
  return async (url) => {
    const entry = map[url];
    return entry ? { bytes: entry.bytes, mime: entry.mime } : null;
  };
}

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

describe("prepareShareInput — istatistik ve içerik korunumu", () => {
  it("istatistikleri, bio ve öne çıkanları korur", async () => {
    const input = await prepareShareInput(BRAND, computeGrid(EXISTING, PLANNED));
    expect(input.brand.name).toBe("Dijivo");
    expect(input.brand.bio).toBe("Grid sunumu");
    expect(input.brand.postCount).toBe(89);
    expect(input.brand.followersCount).toBe(1234);
    expect(input.brand.followingCount).toBe(567);
    expect(input.brand.profileImageUrl).toBe("https://example.com/profile.jpg");
    expect(input.brand.highlights?.[0].imageUrl).toBe(
      "https://example.com/highlight.png",
    );
    expect(input.cells.map((cell) => cell.imageUrl)).toEqual([
      "https://example.com/post-1.jpg",
      "https://example.com/plan-1.jpg",
    ]);
  });
});

describe("prepareShareInput — yerel referansların tamamı çözülür", () => {
  it("blob: görselleri data URL'e çevirir", async () => {
    const restore = stubBtoa();
    try {
      const fetchMock = vi.fn(async () => new Response(new Blob([PNG])));
      const input = await prepareShareInput(
        { ...BRAND, profileImageUrl: "blob:https://app.test/p" },
        computeGrid([{ ...EXISTING[0], imageUrl: "blob:https://app.test/post" }], PLANNED),
        { fetchImage: fetchMock as unknown as typeof fetch },
      );
      expect(input.brand.profileImageUrl).toBe(`data:image/png;base64,${b64(PNG)}`);
      expect(input.cells[0].imageUrl).toBe(`data:image/png;base64,${b64(PNG)}`);
    } finally {
      restore();
    }
  });

  it("idb: görsel referansını IndexedDB okuyucu üzerinden çözer", async () => {
    const restore = stubBtoa();
    try {
      const input = await prepareShareInput(
        BRAND,
        computeGrid([{ ...EXISTING[0], imageUrl: "idb:img-1" }], PLANNED),
        { reader: readerFor({ "idb:img-1": { bytes: JPEG, mime: "image/jpeg" } }) },
      );
      expect(input.cells[0].imageUrl).toBe(`data:image/jpeg;base64,${b64(JPEG)}`);
      expect(findLocalMediaRefs(input)).toEqual([]);
    } finally {
      restore();
    }
  });

  it("idb-video: reel videosunu data URL'e çevirir", async () => {
    const restore = stubBtoa();
    try {
      const reel: ExistingPost[] = [
        {
          ...EXISTING[0],
          postType: "reel",
          mediaType: "video",
          imageUrl: "idb-video:vid-1",
          videoUrl: "idb-video:vid-1",
        },
      ];
      const poster = await prepareShareInput(BRAND, computeGrid(reel, PLANNED), {
        reader: readerFor({ "idb-video:vid-1": { bytes: WEBM, mime: "video/webm" } }),
        posterMaker: async () => ({ bytes: PNG, mime: "image/png" }),
      });
      // Görsel yuvası video baytlarına işaret ediyordu → poster üretildi.
      expect(poster.cells[0].imageUrl).toBe(`data:image/png;base64,${b64(PNG)}`);
      expect(poster.cells[0].videoUrl).toBe(`data:video/webm;base64,${b64(WEBM)}`);
      expect(findLocalMediaRefs(poster)).toEqual([]);
    } finally {
      restore();
    }
  });

  it("çoklu yükleme sonrası tüm hücreler taşınabilir olur", async () => {
    const restore = stubBtoa();
    try {
      const multi: PlannedPost[] = [
        { id: "p1", source: "planlanan", imageUrl: "idb:m1", alt: "a", planOrder: 0 },
        { id: "p2", source: "planlanan", imageUrl: "idb:m2", alt: "b", planOrder: 1 },
        { id: "p3", source: "planlanan", imageUrl: "idb:m3", alt: "c", planOrder: 2 },
      ];
      const input = await prepareShareInput(BRAND, computeGrid([], multi), {
        reader: readerFor({
          "idb:m1": { bytes: PNG, mime: "image/png" },
          "idb:m2": { bytes: JPEG, mime: "image/jpeg" },
          "idb:m3": { bytes: WEBP, mime: "image/webp" },
        }),
      });
      expect(input.cells.map((cell) => cell.imageUrl)).toEqual([
        `data:image/png;base64,${b64(PNG)}`,
        `data:image/jpeg;base64,${b64(JPEG)}`,
        `data:image/webp;base64,${b64(WEBP)}`,
      ]);
      expect(() => assertPortableShareInput(input)).not.toThrow();
    } finally {
      restore();
    }
  });

  it("reel kapağı ayrı kalırken kapaksız reel posterden görsel alır", async () => {
    const restore = stubBtoa();
    try {
      const reel: ExistingPost[] = [
        {
          ...EXISTING[0],
          postType: "reel",
          mediaType: "video",
          imageUrl: "blob:https://app.test/video",
          videoUrl: "blob:https://app.test/video",
          coverImageUrl: "idb:cover",
        },
      ];
      const input = await prepareShareInput(BRAND, computeGrid(reel, PLANNED), {
        reader: readerFor({
          "blob:https://app.test/video": { bytes: MP4, mime: "video/mp4" },
          "idb:cover": { bytes: JPEG, mime: "image/jpeg" },
        }),
        posterMaker: async () => null,
      });
      expect(input.cells[0].coverImageUrl).toBe(`data:image/jpeg;base64,${b64(JPEG)}`);
      expect(input.cells[0].videoUrl).toBe(`data:video/mp4;base64,${b64(MP4)}`);
    } finally {
      restore();
    }
  });
});

describe("prepareShareInput — hata durumları", () => {
  it("poster üretilemeyen kapaksız reel için anlaşılır hata verir", async () => {
    const restore = stubBtoa();
    try {
      const reel: ExistingPost[] = [
        {
          ...EXISTING[0],
          postType: "reel",
          mediaType: "video",
          imageUrl: "idb-video:vid-1",
          videoUrl: "idb-video:vid-1",
        },
      ];
      await expect(
        prepareShareInput(BRAND, computeGrid(reel, PLANNED), {
          reader: readerFor({ "idb-video:vid-1": { bytes: WEBM, mime: "video/webm" } }),
          posterMaker: async () => null,
        }),
      ).rejects.toThrowError(/kapak görseli paylaşımda oluşturulamadı/);
    } finally {
      restore();
    }
  });

  it("bulunamayan yerel referansta hata fırlatır (sessiz boş görsel yok)", async () => {
    const restore = stubBtoa();
    try {
      await expect(
        prepareShareInput(
          BRAND,
          computeGrid([{ ...EXISTING[0], imageUrl: "idb:missing" }], PLANNED),
          { reader: readerFor({}) },
        ),
      ).rejects.toThrowError();
    } finally {
      restore();
    }
  });

  it("tanınmayan baytları desteklenmiyor olarak reddeder", async () => {
    const restore = stubBtoa();
    try {
      const fetchMock = vi.fn(
        async () => new Response(new Blob([new Uint8Array([1, 2, 3, 4, 5])])),
      );
      await expect(
        prepareShareInput(
          BRAND,
          computeGrid([{ ...EXISTING[0], imageUrl: "blob:https://app.test/x" }], PLANNED),
          { fetchImage: fetchMock as unknown as typeof fetch },
        ),
      ).rejects.toThrowError(/paylaşım için desteklenmiyor/);
    } finally {
      restore();
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });
});

describe("prepareShareInput — cross-device workspace medyası", () => {
  it("signed workspace-media URL'sini taşınabilir share data URL'ine dönüştürür", async () => {
    const restore = stubBtoa();
    try {
      const signed = "https://project.supabase.co/storage/v1/object/sign/workspace-media/user/brand/post.png?token=test";
      const input = await prepareShareInput(
        BRAND,
        computeGrid([{ ...EXISTING[0], imageUrl: signed }], []),
        { reader: readerFor({ [signed]: { bytes: PNG, mime: "image/png" } }) },
      );
      expect(input.cells[0].imageUrl).toBe(`data:image/png;base64,${b64(PNG)}`);
    } finally {
      restore();
    }
  });
});
