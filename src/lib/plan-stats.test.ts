import { describe, expect, it } from "vitest";

import { computePlanStats, filterByType } from "./plan-stats";
import type { ExistingPost, PlannedPost } from "./types";

function existing(id: string, overrides: Partial<ExistingPost> = {}): ExistingPost {
  return {
    id,
    source: "mevcut",
    imageUrl: `https://example.com/${id}.jpg`,
    aspectRatio: "1:1",
    postType: "post",
    recencyIndex: 0,
    pinned: false,
    ...overrides,
  };
}

function planned(id: string, overrides: Partial<PlannedPost> = {}): PlannedPost {
  return {
    id,
    source: "planlanan",
    imageUrl: `https://example.com/${id}.jpg`,
    aspectRatio: "1:1",
    postType: "post",
    planOrder: 0,
    ...overrides,
  };
}

describe("computePlanStats", () => {
  it("dağılım, pinned ve toplamları doğru hesaplar", () => {
    const stats = computePlanStats(
      [
        existing("e1", { pinned: true, postType: "post" }),
        existing("e2", { postType: "reel" }),
        existing("e3", { postType: "carousel" }),
      ],
      [
        planned("p1", { postType: "reel" }),
        planned("p2", { postType: undefined }),
      ],
    );
    expect(stats).toEqual({
      total: 5,
      existing: 3,
      planned: 2,
      pinned: 1,
      post: 2, // e1 + p2 (undefined post -> post)
      reel: 2,
      carousel: 1,
    });
  });

  it("boş planda sıfırlar döner", () => {
    expect(computePlanStats([], [])).toEqual({
      total: 0,
      existing: 0,
      planned: 0,
      pinned: 0,
      post: 0,
      reel: 0,
      carousel: 0,
    });
  });
});

describe("filterByType", () => {
  const posts = [
    existing("e1", { postType: "post" }),
    existing("e2", { postType: "reel" }),
    existing("e3", { postType: "carousel" }),
    existing("e4", { postType: undefined }),
  ];

  it("all aynı diziyi döndürür", () => {
    expect(filterByType(posts, "all")).toBe(posts);
  });

  it("tür bazında süzer; undefined post sayılır", () => {
    expect(filterByType(posts, "reel").map((p) => p.id)).toEqual(["e2"]);
    expect(filterByType(posts, "carousel").map((p) => p.id)).toEqual(["e3"]);
    expect(filterByType(posts, "post").map((p) => p.id)).toEqual(["e1", "e4"]);
  });
});
