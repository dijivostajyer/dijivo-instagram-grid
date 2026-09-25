import { beforeEach, describe, expect, it } from "vitest";

import { computeGrid, pickPinnedPosts } from "./grid";
import type { ExistingPost, PlannedPost } from "./types";

let nextId = 0;

beforeEach(() => {
  nextId = 0;
});

function existing(
  recencyIndex: number,
  overrides: Partial<ExistingPost> = {},
): ExistingPost {
  nextId += 1;
  return {
    id: `e${nextId}`,
    source: "mevcut",
    imageUrl: `/img/e${nextId}.jpg`,
    recencyIndex,
    pinned: false,
    ...overrides,
  };
}

function planned(planOrder: number): PlannedPost {
  nextId += 1;
  return {
    id: `p${nextId}`,
    source: "planlanan",
    imageUrl: `/img/p${nextId}.jpg`,
    planOrder,
  };
}

function gridIds(
  brandPosts: ExistingPost[],
  plannedPosts: PlannedPost[] = [],
): string[] {
  return computeGrid(brandPosts, plannedPosts).cells.map((cell) => cell.post.id);
}

describe("computeGrid — temel sıralama", () => {
  it("boş girdide boş grid döndürür", () => {
    const result = computeGrid([], []);
    expect(result.cells).toHaveLength(0);
    expect(result.rowCount).toBe(0);
    expect(result.pinnedCount).toBe(0);
  });

  it("tek mevcut gönderiyi ilk hücreye koyar", () => {
    const ids = gridIds([existing(0)]);
    expect(ids).toHaveLength(1);
    expect(ids[0]).toBe("e1");
  });

  it("en yeni mevcut içerik (recencyIndex 0) üst solda başlar", () => {
    const result = computeGrid(
      [existing(2), existing(0), existing(1)],
      [],
    );
    const ids = result.cells.map((cell) => cell.post.id);
    expect(ids[0]).toBe("e2"); // recencyIndex 0 → en yeni → üst sol
    expect(ids[1]).toBe("e3"); // recencyIndex 1
    expect(ids[2]).toBe("e1"); // recencyIndex 2
  });

  it("3x3 gridde satır/sütun konumları doğru hesaplanır", () => {
    const posts = [existing(0), existing(1), existing(2), existing(3), existing(4)];
    const result = computeGrid(posts, []);
    expect(result.rowCount).toBe(2);
    expect(result.cells[0]).toMatchObject({ row: 0, column: 0 });
    expect(result.cells[1]).toMatchObject({ row: 0, column: 1 });
    expect(result.cells[2]).toMatchObject({ row: 0, column: 2 });
    expect(result.cells[3]).toMatchObject({ row: 1, column: 0 });
    expect(result.cells[4]).toMatchObject({ row: 1, column: 1 });
  });

  it("tam satır olmayan akışta boş hücre eklenmez (8 içerik → 3 satır)", () => {
    const posts = Array.from({ length: 8 }, (_, i) => existing(i));
    const result = computeGrid(posts, []);
    expect(result.cells).toHaveLength(8);
    expect(result.rowCount).toBe(3);
    expect(result.cells[7]).toMatchObject({ row: 2, column: 1 });
  });
});

describe("computeGrid — pinned kuralları", () => {
  it("pinned gönderi recency'sine bakmadan en üst satıra çıkar", () => {
    // e1 en yeni; ama e3 pinned → e3 ilk hücrede.
    const posts = [
      existing(0),
      existing(1),
      existing(2, { pinned: true, pinnedOrder: 0 }),
    ];
    const ids = gridIds(posts);
    expect(ids[0]).toBe("e3");
    expect(ids[1]).toBe("e1");
    expect(ids[2]).toBe("e2");
  });

  it("pinned gönderiler pinnedOrder'a göre soldan sağa dizilir", () => {
    const posts = [
      existing(0),
      existing(1, { pinned: true, pinnedOrder: 1 }),
      existing(2, { pinned: true, pinnedOrder: 0 }),
      existing(3),
    ];
    const ids = gridIds(posts);
    expect(ids.slice(0, 2)).toEqual(["e3", "e2"]); // order 0, sonra order 1
    expect(ids.slice(2)).toEqual(["e1", "e4"]); // kronolojik akış devam eder
  });

  it("3'ten fazla pinned gönderi varsa yalnızca ilk 3'ü en üstte olur", () => {
    const posts = [
      existing(0),
      existing(1, { pinned: true, pinnedOrder: 0 }),
      existing(2, { pinned: true, pinnedOrder: 1 }),
      existing(3, { pinned: true, pinnedOrder: 2 }),
      existing(4, { pinned: true, pinnedOrder: 3 }),
    ];
    const result = computeGrid(posts, []);
    expect(result.pinnedCount).toBe(3);
    const ids = result.cells.map((cell) => cell.post.id);
    expect(ids.slice(0, 3)).toEqual(["e2", "e3", "e4"]);
    expect(ids[3]).toBe("e1"); // en yeni unpinned akışı başlatır
    expect(ids[4]).toBe("e5"); // fazladan pinned, normal akışa düşer
  });

  it("pinnedOrder olmayan pinned gönderiler, sıralı pinnedlerin arkasına recency ile girer", () => {
    const posts = [
      existing(5, { pinned: true }), // sırasız pinned
      existing(1, { pinned: true, pinnedOrder: 0 }),
      existing(0),
    ];
    const ids = gridIds(posts);
    expect(ids).toEqual(["e2", "e1", "e3"]);
  });

  it("pinned gönderi kaldırılınca grid yeniden hesaplanır (kronolojik akış döner)", () => {
    const posts = [
      existing(0, { pinned: true, pinnedOrder: 0 }),
      existing(1),
      existing(2),
    ];
    expect(gridIds(posts)[0]).toBe("e1");

    const unpinned = posts.map((post) =>
      post.id === "e1" ? { ...post, pinned: false, pinnedOrder: undefined } : post,
    );
    expect(gridIds(unpinned)).toEqual(["e1", "e2", "e3"]);
  });
});

describe("computeGrid — mevcut + planlanan karışımı", () => {
  it("planlanan gönderiler mevcut akışın üstüne eklenir", () => {
    const posts = [existing(0), existing(1)];
    const plannedPosts = [planned(0), planned(1)];
    const ids = gridIds(posts, plannedPosts);
    // planOrder 0 → en yakın yayın → üst sol
    expect(ids).toEqual(["p3", "p4", "e1", "e2"]);
  });

  it("planlanan gönderiler planOrder sırasıyla dizilir", () => {
    const plannedPosts = [planned(2), planned(0), planned(1)];
    const ids = gridIds([], plannedPosts);
    expect(ids).toEqual(["p2", "p3", "p1"]);
  });

  it("pinned + planlanan + mevcut birlikte doğru akar", () => {
    const posts = [
      existing(0, { pinned: true, pinnedOrder: 1 }),
      existing(1, { pinned: true, pinnedOrder: 0 }),
      existing(2),
      existing(3),
    ];
    const plannedPosts = [planned(0), planned(1)];
    const ids = gridIds(posts, plannedPosts);
    // Üst satır: pinnedler. Sonra planlananlar (p5=order0, p6=order1), sonra mevcutlar.
    expect(ids).toEqual(["e2", "e1", "p5", "p6", "e3", "e4"]);
    const result = computeGrid(posts, plannedPosts);
    expect(result.rowCount).toBe(2);
    expect(result.cells[0]).toMatchObject({ row: 0, column: 0, pinned: true });
    expect(result.cells[2]).toMatchObject({ row: 0, column: 2, pinned: false });
  });
});

describe("pickPinnedPosts", () => {
  it("pinned olmayan gönderileri boş döndürür", () => {
    expect(pickPinnedPosts([existing(0), existing(1)])).toHaveLength(0);
  });

  it("en fazla 3 pinned döndürür ve pinnedOrder'a göre sıralar", () => {
    const posts = [
      existing(0, { pinned: true, pinnedOrder: 2 }),
      existing(1, { pinned: true, pinnedOrder: 0 }),
      existing(2, { pinned: true, pinnedOrder: 1 }),
      existing(3, { pinned: true, pinnedOrder: 9 }),
    ];
    const pinned = pickPinnedPosts(posts);
    expect(pinned.map((post) => post.id)).toEqual(["e2", "e3", "e1"]);
  });
});
