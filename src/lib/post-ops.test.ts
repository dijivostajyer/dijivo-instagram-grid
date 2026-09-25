import { beforeEach, describe, expect, it } from "vitest";

import {
  addExistingPost,
  addPlannedPost,
  deleteExistingPost,
  deletePlannedPost,
  listPinnedPosts,
  movePinnedPost,
  pinPost,
  reorderPlannedPosts,
  reorderPinnedPosts,
  unpinPost,
} from "./post-ops";
import type { ExistingPost, PlannedPost } from "./types";

let n = 0;
beforeEach(() => {
  n = 0;
});

function existing(
  recencyIndex: number,
  overrides: Partial<ExistingPost> = {},
): ExistingPost {
  n += 1;
  return {
    id: `e${n}`,
    source: "mevcut",
    imageUrl: `/img/e${n}.jpg`,
    recencyIndex,
    pinned: false,
    ...overrides,
  };
}

function planned(planOrder: number): PlannedPost {
  n += 1;
  return {
    id: `p${n}`,
    source: "planlanan",
    imageUrl: `/img/p${n}.jpg`,
    planOrder,
  };
}

describe("pinPost — pin limiti ve sıralama", () => {
  it("gönderiyi pinned yapar ve pinnedOrder'ı en sona atar", () => {
    const posts = [existing(0, { pinned: true, pinnedOrder: 0 }), existing(1)];
    const { posts: next, error } = pinPost(posts, "e2");
    expect(error).toBeUndefined();
    expect(next.find((p) => p.id === "e2")).toMatchObject({
      pinned: true,
      pinnedOrder: 1,
    });
  });

  it("3 pinned varken 4. pin denemesi Türkçe hata döndürür ve gridi değiştirmez", () => {
    const posts = [
      existing(0, { pinned: true, pinnedOrder: 0 }),
      existing(1, { pinned: true, pinnedOrder: 1 }),
      existing(2, { pinned: true, pinnedOrder: 2 }),
      existing(3),
    ];
    const { posts: next, error } = pinPost(posts, "e4");
    expect(error).toBe("En fazla 3 gönderi sabitlenebilir. Sabitlemek için önce pinned gönderilerden birinin sabitliğini kaldırın.");
    expect(next).toBe(posts);
    expect(next.filter((p) => p.pinned)).toHaveLength(3);
  });

  it("pin kaldırıldıktan sonra yeni pin ataması çalışır", () => {
    let posts = [
      existing(0, { pinned: true, pinnedOrder: 0 }),
      existing(1, { pinned: true, pinnedOrder: 1 }),
      existing(2, { pinned: true, pinnedOrder: 2 }),
      existing(3),
    ];
    posts = unpinPost(posts, "e2");
    const { posts: next, error } = pinPost(posts, "e4");
    expect(error).toBeUndefined();
    expect(next.filter((p) => p.pinned)).toHaveLength(3);
    expect(next.find((p) => p.id === "e4")?.pinnedOrder).toBe(2);
  });
});

describe("unpinPost ve reorderPinnedPosts", () => {
  it("unpin sonrası kalan pinnedlerin göreli sırası korunur ve sıra 0'dan sıkıştırılır", () => {
    const posts = [
      existing(0, { pinned: true, pinnedOrder: 0 }),
      existing(1, { pinned: true, pinnedOrder: 1 }),
      existing(2, { pinned: true, pinnedOrder: 2 }),
    ];
    const next = unpinPost(posts, "e1");
    // Boşluk doldurulur: e2 → 0, e3 → 1 (göreli sıra aynı).
    expect(next.find((p) => p.id === "e2")).toMatchObject({
      pinned: true,
      pinnedOrder: 0,
    });
    expect(next.find((p) => p.id === "e3")).toMatchObject({
      pinned: true,
      pinnedOrder: 1,
    });
    expect(listPinnedPosts(next).map((p) => p.id)).toEqual(["e2", "e3"]);
  });

  it("pinned sırası sürüklenerek değiştirilebilir", () => {
    const posts = [
      existing(0, { pinned: true, pinnedOrder: 0 }),
      existing(1, { pinned: true, pinnedOrder: 1 }),
      existing(2, { pinned: true, pinnedOrder: 2 }),
    ];
    const next = reorderPinnedPosts(posts, ["e3", "e1", "e2"]);
    expect(listPinnedPosts(next).map((p) => p.id)).toEqual(["e3", "e1", "e2"]);
  });

  it("movePinnedPost ile sağ/sol taşıma çalışır", () => {
    const posts = [
      existing(0, { pinned: true, pinnedOrder: 0 }),
      existing(1, { pinned: true, pinnedOrder: 1 }),
    ];
    const movedRight = movePinnedPost(posts, "e1", 1);
    expect(listPinnedPosts(movedRight).map((p) => p.id)).toEqual(["e2", "e1"]);
    const movedBack = movePinnedPost(movedRight, "e1", -1);
    expect(listPinnedPosts(movedBack).map((p) => p.id)).toEqual(["e1", "e2"]);
  });

  it("movePinnedPost sınırda liste değişmez", () => {
    const posts = [existing(0, { pinned: true, pinnedOrder: 0 })];
    expect(movePinnedPost(posts, "e1", -1)).toBe(posts);
    expect(movePinnedPost(posts, "e1", 1)).toBe(posts);
  });
});

describe("addExistingPost — recency kontrolü", () => {
  it("'enYeni' seçilince recencyIndex 0 olur ve diğerleri kayar", () => {
    const posts = [existing(0), existing(1)];
    const { posts: next, post } = addExistingPost(posts, {
      imageUrl: "/img/yeni.jpg",
      recency: "enYeni",
    });
    expect(post.recencyIndex).toBe(0);
    expect(next.find((p) => p.id === "e1")?.recencyIndex).toBe(1);
    expect(next.find((p) => p.id === "e2")?.recencyIndex).toBe(2);
  });

  it("'enEski' seçilince en büyük recency + 1 olur", () => {
    const posts = [existing(0), existing(1)];
    const { post } = addExistingPost(posts, {
      imageUrl: "/img/eski.jpg",
      recency: "enEski",
    });
    expect(post.recencyIndex).toBe(2);
  });
});

describe("deleteExistingPost", () => {
  it("gönderiyi siler ve recency'leri yeniden yazar", () => {
    const posts = [existing(0), existing(1, { pinned: true, pinnedOrder: 0 }), existing(2)];
    const next = deleteExistingPost(posts, "e2");
    expect(next).toHaveLength(2);
    expect(next.map((p) => p.recencyIndex)).toEqual([0, 1]);
    expect(next.every((p) => !p.pinned)).toBe(true);
  });
});

describe("planlanan gönderi işlemleri", () => {
  it("addPlannedPost yeni gönderiyi ilk yayınlanacak sıraya koyar", () => {
    const posts = [planned(0), planned(1)];
    const { posts: next, post } = addPlannedPost(posts, {
      imageUrl: "/img/plan-yeni.jpg",
    });
    expect(post.planOrder).toBe(0);
    expect(next.find((p) => p.id === "p1")?.planOrder).toBe(1);
    expect(next.find((p) => p.id === "p2")?.planOrder).toBe(2);
  });

  it("sürükle-bırak sırası planOrder'a yansır ve grid sırası değişir", () => {
    const posts = [planned(0), planned(1), planned(2)];
    const next = reorderPlannedPosts(posts, ["p3", "p1", "p2"]);
    expect(next.find((p) => p.id === "p3")?.planOrder).toBe(0);
    expect(next.find((p) => p.id === "p1")?.planOrder).toBe(1);
    expect(next.find((p) => p.id === "p2")?.planOrder).toBe(2);
  });

  it("deletePlannedPost sırayı yeniden yazar", () => {
    const posts = [planned(0), planned(1), planned(2)];
    const next = deletePlannedPost(posts, "p2");
    expect(next.map((p) => p.id)).toEqual(["p1", "p3"]);
    expect(next.map((p) => p.planOrder)).toEqual([0, 1]);
  });
});
