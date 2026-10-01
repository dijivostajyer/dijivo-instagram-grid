import { afterEach, describe, expect, it, vi } from "vitest";

import { computeGrid } from "./grid";
import { prepareShareInput } from "./share-client";
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

describe("prepareShareInput", () => {
  it("istatistikleri, bio ve öne çıkanları blob→data URL dönüşümünde korur", async () => {
    const input = await prepareShareInput(
      BRAND,
      computeGrid(EXISTING, PLANNED),
    );
    expect(input.brand.name).toBe("Dijivo");
    expect(input.brand.username).toBe("dijivo");
    expect(input.brand.bio).toBe("Grid sunumu");
    expect(input.brand.postCount).toBe(89);
    expect(input.brand.followersCount).toBe(1234);
    expect(input.brand.followingCount).toBe(567);
    expect(input.brand.profileImageUrl).toBe("https://example.com/profile.jpg");
    expect(input.brand.highlights?.[0]).toEqual({
      id: "h1",
      title: "Kampanya",
      imageUrl: "https://example.com/highlight.png",
    });
    expect(input.cells.map((cell) => cell.imageUrl)).toEqual([
      "https://example.com/post-1.jpg",
      "https://example.com/plan-1.jpg",
    ]);
  });

  it("blob URL'lerini taşınabilir data URL'e çevirir", async () => {
    const globalWithWindow = globalThis as unknown as {
      window?: { btoa: (input: string) => string };
    };
    const originalWindow = globalWithWindow.window;
    globalWithWindow.window = {
      btoa: (input: string) =>
        Buffer.from(input, "binary").toString("base64"),
    };
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const fetchMock = vi.fn(
      async () =>
        new Response(new Blob([bytes], { type: "image/png" })),
    );
    try {
      const blobBrand: Brand = {
        ...BRAND,
        profileImageUrl: "blob:https://app.test/profile",
        highlights: [
          { id: "h1", title: "Kampanya", imageUrl: "blob:https://app.test/highlight" },
        ],
      };
      const blobExisting: ExistingPost[] = [
        { ...EXISTING[0], imageUrl: "blob:https://app.test/post" },
      ];
      const input = await prepareShareInput(
        blobBrand,
        computeGrid(blobExisting, PLANNED),
        fetchMock as unknown as typeof fetch,
      );
      expect(input.brand.profileImageUrl).toBe("data:image/png;base64,iVBORw==");
      expect(input.brand.highlights?.[0].imageUrl).toBe(
        "data:image/png;base64,iVBORw==",
      );
      expect(input.cells[0].imageUrl).toBe("data:image/png;base64,iVBORw==");
      expect(input.cells[1].imageUrl).toBe("https://example.com/plan-1.jpg");
      expect(fetchMock).toHaveBeenCalledTimes(3);
    } finally {
      globalWithWindow.window = originalWindow;
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });
});
