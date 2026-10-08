import { describe, expect, it } from "vitest";

import { computeGrid } from "./grid";
import {
  createShareSnapshot,
  deserializeShareSnapshot,
  isShareableVideoUrl,
  serializeShareSnapshot,
  shareInputFromGrid,
  SHARE_SNAPSHOT_VERSION,
  validateShareCreateInput,
  validateShareSnapshotInput,
  type ShareSnapshotInput,
} from "./share";
import { InMemoryShareStore } from "./share-store";
import { generateShareToken, isValidShareToken } from "./share-token";
import type { Brand, ExistingPost, PlannedPost } from "./types";

const TOKEN = "3e1a1c76-7958-4d4f-86c6-2727195fd44c";
const CREATED_AT = "2026-09-25T12:00:00.000Z";

const BRAND: Brand = {
  id: "brand-1",
  name: "Dijivo",
  username: "dijivo",
  bio: "Grid sunumu",
  profileImageUrl: "https://example.com/profile.jpg",
};

function input(overrides: Partial<ShareSnapshotInput> = {}): ShareSnapshotInput {
  return {
    brand: {
      name: BRAND.name,
      username: BRAND.username,
      bio: BRAND.bio,
      profileImageUrl: BRAND.profileImageUrl,
    },
    cells: [
      {
        id: "post-1",
        source: "mevcut",
        imageUrl: "https://example.com/post-1.jpg",
        alt: "Gönderi 1",
        position: 0,
        row: 0,
        column: 0,
        pinned: true,
      },
    ],
    ...overrides,
  };
}

describe("share token", () => {
  it("UUID biçiminde, tahmin edilemeyen token üretir", () => {
    expect(generateShareToken(() => TOKEN)).toBe(TOKEN);
    expect(isValidShareToken(TOKEN)).toBe(true);
    expect(isValidShareToken("42")).toBe(false);
  });
});

describe("share snapshot", () => {
  it("hydration'dan gelen nullable opsiyonel post alanlarını payload'da undefined'a çevirir", () => {
    const hydrated = computeGrid([{ ...input().cells[0], source: "mevcut", recencyIndex: 0, pinned: false, alt: null, caption: null, mediaType: null } as unknown as ExistingPost], []);
    const payload = shareInputFromGrid({ ...BRAND, bio: null, postCount: null } as unknown as Brand, hydrated);
    expect(payload.cells[0].alt).toBeUndefined();
    expect(payload.cells[0].caption).toBeUndefined();
    expect(payload.cells[0].mediaType).toBeUndefined();
    expect(validateShareSnapshotInput(payload)).not.toBeNull();
  });

  it("create payload'ında user-scoped workspace-media ref kabul edilir ama snapshot'ta kabul edilmez", () => {
    const payload = input({ cells: [{ ...input().cells[0], imageUrl: "storage:workspace-media/123e4567-e89b-42d3-a456-426614174000/brand/post.png" }] });
    expect(validateShareCreateInput(payload)).not.toBeNull();
    expect(validateShareSnapshotInput(payload)).toBeNull();
  });
  it("serialize/validation roundtrip brand bilgilerini korur", () => {
    const snapshot = createShareSnapshot(input(), TOKEN, CREATED_AT);
    expect(deserializeShareSnapshot(serializeShareSnapshot(snapshot))).toEqual(snapshot);
    expect(snapshot.brand).toEqual({
      name: "Dijivo",
      username: "dijivo",
      bio: "Grid sunumu",
      profileImageUrl: "https://example.com/profile.jpg",
    });
  });

  it("hesaplanmış grid sırasını, pinned ve kaynak bilgisini korur", () => {
    const existing: ExistingPost[] = [
      { id: "old", source: "mevcut", imageUrl: "https://example.com/old.jpg", recencyIndex: 1, pinned: false },
      { id: "pin", source: "mevcut", imageUrl: "https://example.com/pin.jpg", recencyIndex: 2, pinned: true, pinnedOrder: 0 },
    ];
    const planned: PlannedPost[] = [
      { id: "plan", source: "planlanan", imageUrl: "https://example.com/plan.jpg", planOrder: 0 },
    ];
    const snapshot = createShareSnapshot(
      shareInputFromGrid(BRAND, computeGrid(existing, planned)),
      TOKEN,
      CREATED_AT,
    );

    expect(snapshot.cells.map((cell) => [cell.id, cell.source, cell.pinned])).toEqual([
      ["pin", "mevcut", true],
      ["plan", "planlanan", false],
      ["old", "mevcut", false],
    ]);
    expect(snapshot.cells.map((cell) => cell.position)).toEqual([0, 1, 2]);
  });

  it("istatistikleri, öne çıkanları ve post türünü immutable snapshotta korur", () => {
    const snapshot = createShareSnapshot(input({
      brand: { ...input().brand, followersCount: 1200, highlights: [{ id: "h1", title: "Yeni" }] },
      cells: [{ ...input().cells[0], postType: "reel" }],
    }), TOKEN, CREATED_AT);
    expect(snapshot.brand.followersCount).toBe(1200);
    expect(snapshot.brand.highlights?.[0].title).toBe("Yeni");
    expect(snapshot.cells[0].postType).toBe("reel");
  });

  it("boş grid paylaşımını reddeder", () => {
    expect(() => createShareSnapshot(input({ cells: [] }), TOKEN, CREATED_AT)).toThrow(
      "Paylaşılabilir grid bulunamadı.",
    );
  });

  it("bozuk snapshot için güvenli fallback döner", () => {
    expect(deserializeShareSnapshot("{bozuk")).toBeNull();
    expect(deserializeShareSnapshot(JSON.stringify({ version: 1, token: TOKEN }))).toBeNull();
  });

  it("blob ve idb görsel referanslarını snapshot'a yazmaz", () => {
    expect(() =>
      createShareSnapshot(
        input({
          cells: [{ ...input().cells[0], imageUrl: "blob:https://editor.test/image" }],
        }),
        TOKEN,
        CREATED_AT,
      ),
    ).toThrow("Paylaşılabilir grid bulunamadı.");
    expect(() =>
      createShareSnapshot(
        input({ brand: { ...input().brand, profileImageUrl: "idb:uploaded-image" } }),
        TOKEN,
        CREATED_AT,
      ),
    ).toThrow("Paylaşılabilir grid bulunamadı.");
  });
});

describe("share caption + reel metadata (§12/§22)", () => {
  it("caption snapshot'ta uçtan uca korunur (§12)", () => {
    const snapshot = createShareSnapshot(
      input({
        cells: [{ ...input().cells[0], caption: "Yayın başlığı #dijivo" }],
      }),
      TOKEN,
      CREATED_AT,
    );
    const restored = deserializeShareSnapshot(
      serializeShareSnapshot(snapshot),
    );
    expect(restored?.cells[0].caption).toBe("Yayın başlığı #dijivo");
  });

  it("caption'sız eski (legacy) snapshot hâlâ açılır (§12)", () => {
    const legacy = {
      version: SHARE_SNAPSHOT_VERSION,
      token: TOKEN,
      createdAt: CREATED_AT,
      brand: { name: "Dijivo", username: "dijivo" },
      cells: [
        {
          id: "post-1",
          source: "mevcut",
          imageUrl: "https://example.com/post-1.jpg",
          position: 0,
          row: 0,
          column: 0,
          pinned: false,
        },
      ],
    };
    const restored = deserializeShareSnapshot(JSON.stringify(legacy));
    expect(restored).not.toBeNull();
    expect(restored?.cells[0].caption).toBeUndefined();
  });

  it("reel video metadatası snapshot'ta korunur (§22)", () => {
    const snapshot = createShareSnapshot(
      input({
        cells: [
          {
            ...input().cells[0],
            postType: "reel",
            caption: "Reel caption",
            mediaType: "video",
            videoUrl:
              "storage:media/3e1a1c76-7958-4d4f-86c6-2727195fd44c/0-a1b2c3d4.mp4",
            coverImageUrl: "https://example.com/cover.jpg",
          },
        ],
      }),
      TOKEN,
      CREATED_AT,
    );
    const restored = deserializeShareSnapshot(
      serializeShareSnapshot(snapshot),
    );
    expect(restored?.cells[0].postType).toBe("reel");
    expect(restored?.cells[0].mediaType).toBe("video");
    expect(restored?.cells[0].videoUrl).toContain("storage:media/");
    expect(restored?.cells[0].coverImageUrl).toBe(
      "https://example.com/cover.jpg",
    );
  });

  it("eski görsel gönderisi (mediaType tanımsız) hâlâ paylaşılabilir", () => {
    const snapshot = createShareSnapshot(input(), TOKEN, CREATED_AT);
    expect(snapshot.cells[0].mediaType).toBeUndefined();
    expect(snapshot.cells[0].postType).toBe("post");
    expect(deserializeShareSnapshot(serializeShareSnapshot(snapshot))).not.toBeNull();
  });

  it("blob/idb-video video URL'leri snapshot'a yazılmaz", () => {
    expect(() =>
      createShareSnapshot(
        input({
          cells: [
            { ...input().cells[0], mediaType: "video", videoUrl: "blob:https://editor.test/v.mp4" },
          ],
        }),
        TOKEN,
        CREATED_AT,
      ),
    ).toThrow("Paylaşılabilir grid bulunamadı.");
    expect(() =>
      createShareSnapshot(
        input({
          cells: [{ ...input().cells[0], mediaType: "video", videoUrl: "idb-video:abc" }],
        }),
        TOKEN,
        CREATED_AT,
      ),
    ).toThrow("Paylaşılabilir grid bulunamadı.");
  });

  it("shareInputFromGrid: caption/media/video alanlarını editor'dan taşır", () => {
    const existing: ExistingPost[] = [
      {
        id: "reel-1",
        source: "mevcut",
        imageUrl: "https://example.com/cover.jpg",
        recencyIndex: 0,
        pinned: false,
        postType: "reel",
        caption: "Reel #yayin",
        mediaType: "video",
        videoUrl: "idb-video:abc",
        coverImageUrl: "https://example.com/cover.jpg",
      },
    ];
    const shareInput = shareInputFromGrid(
      BRAND,
      computeGrid(existing, []),
    );
    const cell = shareInput.cells[0];
    expect(cell.caption).toBe("Reel #yayin");
    expect(cell.mediaType).toBe("video");
    expect(cell.videoUrl).toBe("idb-video:abc");
    expect(cell.coverImageUrl).toBe("https://example.com/cover.jpg");
  });

  it("readonly share modal verisi: hücre username/caption/media taşır (§22)", () => {
    const snapshot = createShareSnapshot(
      input({
        cells: [
          {
            ...input().cells[0],
            caption: "Modal caption #test",
            postType: "reel",
            mediaType: "video",
            videoUrl:
              "storage:media/3e1a1c76-7958-4d4f-86c6-2727195fd44c/0-a1b2c3d4.mp4",
          },
        ],
      }),
      TOKEN,
      CREATED_AT,
    );
    // SharePostModal'ın tükettiği salt-okunur veri modeli.
    expect(snapshot.brand.username).toBe("dijivo");
    const cell = snapshot.cells[0];
    expect(cell.caption).toBe("Modal caption #test");
    expect(cell.imageUrl).toBe("https://example.com/post-1.jpg");
    expect(cell.mediaType).toBe("video");
    expect(cell.videoUrl).toMatch(/^storage:media\//);
  });
});

describe("isShareableVideoUrl (§4/§22)", () => {
  it("private share-media storage referansını kabul eder", () => {
    expect(
      isShareableVideoUrl(
        "storage:media/3e1a1c76-7958-4d4f-86c6-2727195fd44c/0-a1b2c3d4.mp4",
      ),
    ).toBe(true);
    expect(
      isShareableVideoUrl(
        "storage:media/3e1a1c76-7958-4d4f-86c6-2727195fd44c/0-a1b2c3d4.webm",
      ),
    ).toBe(true);
  });

  it("data URL ve http(s) akışını kabul eder", () => {
    expect(isShareableVideoUrl("data:video/mp4;base64,AAAAHGZ0eXBpc29t")).toBe(true);
    expect(isShareableVideoUrl("data:video/webm;base64,GkXFuAAA")).toBe(true);
    expect(isShareableVideoUrl("https://cdn.example.com/reel.mp4")).toBe(true);
    expect(isShareableVideoUrl("http://cdn.example.com/reel.webm")).toBe(true);
  });

  it("taşınamaz referansları ve image bucket yollarını reddeder", () => {
    expect(isShareableVideoUrl("blob:https://editor.test/v.mp4")).toBe(false);
    expect(isShareableVideoUrl("idb:video-ref")).toBe(false);
    expect(isShareableVideoUrl("idb-video:abc")).toBe(false);
    expect(
      isShareableVideoUrl(
        "storage:shares/3e1a1c76-7958-4d4f-86c6-2727195fd44c/0-a1b2c3d4.jpg",
      ),
    ).toBe(false);
    expect(isShareableVideoUrl("data:image/png;base64,iVBORw0KGgo=")).toBe(false);
    expect(isShareableVideoUrl("not-a-url")).toBe(false);
  });
});

describe("in-memory ShareStore adapter", () => {
  it("bulunamayan veya geçersiz token için null döner", async () => {
    const store = new InMemoryShareStore(() => TOKEN, () => new Date(CREATED_AT));
    await expect(store.get("bad-token")).resolves.toBeNull();
    await expect(store.get("f4a2e882-769f-4a1b-801f-3409a430afcb")).resolves.toBeNull();
  });

  it("immutable snapshot saklar; editor girdisindeki sonraki değişiklikler linki değiştirmez", async () => {
    const store = new InMemoryShareStore(() => TOKEN, () => new Date(CREATED_AT));
    const source = input();
    const created = await store.create(source);
    source.brand.name = "Değiştirildi";
    source.cells[0].imageUrl = "https://example.com/new.jpg";

    const restored = await store.get(created.token);
    expect(restored?.brand.name).toBe("Dijivo");
    expect(restored?.cells[0].imageUrl).toBe("https://example.com/post-1.jpg");
  });
});
