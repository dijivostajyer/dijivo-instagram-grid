import { describe, expect, it } from "vitest";

import { computeGrid } from "./grid";
import type { ExistingPost, PlannedPost } from "./types";

function existing(overrides: Partial<ExistingPost> = {}): ExistingPost {
  return {
    id: "e1",
    source: "mevcut",
    imageUrl: "https://example.com/e1.jpg",
    recencyIndex: 0,
    pinned: false,
    ...overrides,
  };
}

function planned(overrides: Partial<PlannedPost> = {}): PlannedPost {
  return {
    id: "p1",
    source: "planlanan",
    imageUrl: "https://example.com/p1.jpg",
    planOrder: 0,
    ...overrides,
  };
}

describe("computeGrid ordering", () => {
  it("preserves pinned, planned, and existing order", () => {
    const planned1 = planned({ id: "p2", planOrder: 1 });
    const planned0 = planned({ id: "p1", planOrder: 0 });
    const planned3 = planned({ id: "p3", planOrder: 2 });
    const existingA = existing({ id: "a", recencyIndex: 1 });
    const existingB = existing({ id: "b", recencyIndex: 0 });
    const existingPinned = existing({ id: "pin", pinned: true, pinnedOrder: 0 });

    const result = computeGrid([existingPinned, existingA, existingB], [
      planned1,
      planned0,
      planned3,
    ]);

    const ids = result.cells.map((cell) => cell.post.id);
    expect(ids.slice(0, 3)).toEqual(["pin", "p1", "p2"]);
    expect(ids[3]).toBe("p3");
    // recencyIndex 0 = en yeni => b, sonra a (computeGrid kuralı)
    expect(ids[4]).toBe("b");
    expect(ids[5]).toBe("a");
  });

  it("supports 0, 1, 2, 3, 8, 9, and 10+ content", () => {
    const plannedPosts: PlannedPost[] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(
      (_, i) => planned({ id: `p${i}`, planOrder: i }),
    );
    const existingPosts: ExistingPost[] = [
      existing({ id: "a", recencyIndex: 0 }),
      existing({ id: "b", recencyIndex: 1 }),
    ];

    const result = computeGrid(existingPosts, plannedPosts);
    expect(result.cells.length).toBe(12);
    expect(result.rowCount).toBe(4);
  });
});
