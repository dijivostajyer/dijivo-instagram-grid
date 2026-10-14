import { describe, expect, it } from "vitest";

import { computeGrid } from "./grid";
import { canDropInGridZone, gridCellZone, reorderGridPosts } from "./grid-reorder";
import { calculateExportCellRects, calculateExportLayout } from "./export";
import { shareInputFromGrid } from "./share";
import type { ExistingPost, PlannedPost, PostType } from "./types";

const existing = (id: string, recencyIndex: number, extra: Partial<ExistingPost> = {}): ExistingPost => ({
  id, source: "mevcut", imageUrl: `https://cdn.test/${id}.jpg`, recencyIndex, pinned: false, ...extra,
});
const pinned = (id: string, pinnedOrder: number, recencyIndex = 100 + pinnedOrder): ExistingPost =>
  existing(id, recencyIndex, { pinned: true, pinnedOrder });
const planned = (id: string, planOrder: number, postType?: PostType): PlannedPost => ({
  id, source: "planlanan", imageUrl: `https://cdn.test/${id}.jpg`, planOrder, postType,
});
const order = (existingPosts: ExistingPost[], plannedPosts: PlannedPost[] = []) =>
  computeGrid(existingPosts, plannedPosts).cells.map((cell) => cell.post.id);

function apply(existingPosts: ExistingPost[], plannedPosts: PlannedPost[], activeId: string, overId: string) {
  const next = reorderGridPosts(existingPosts, plannedPosts, activeId, overId);
  return next ? order(next.existingPosts, next.plannedPosts) : null;
}

describe("grid bölgeleri", () => {
  it("sabitlenmiş / planlanan / mevcut bölgeleri ayırt edilir", () => {
    const { cells } = computeGrid([pinned("P1", 0), existing("N1", 0)], [planned("L1", 0)]);
    expect(cells.map((cell) => [cell.post.id, gridCellZone(cell)])).toEqual([["P1", "pinned"], ["L1", "planned"], ["N1", "existing"]]);
    expect(canDropInGridZone("pinned", "pinned")).toBe(true);
    expect(canDropInGridZone("pinned", "existing")).toBe(false);
    expect(canDropInGridZone("existing", "planned")).toBe(false);
    expect(canDropInGridZone(null, "existing")).toBe(false);
  });
});

describe("reorderGridPosts", () => {
  it("A. normal reorder: N3 başa → N3 N1 N2", () => {
    const posts = [existing("N1", 0), existing("N2", 1), existing("N3", 2)];
    expect(apply(posts, [], "N3", "N1")).toEqual(["N3", "N1", "N2"]);
  });

  it("A. planlananlar kendi arasında: L3 başa → L3 L1 L2", () => {
    const plans = [planned("L1", 0), planned("L2", 1), planned("L3", 2)];
    expect(apply([], plans, "L3", "L1")).toEqual(["L3", "L1", "L2"]);
  });

  it("B. pinned kendi arasında: P3 başa → P3 P1 P2", () => {
    const posts = [pinned("P1", 0), pinned("P2", 1), pinned("P3", 2), existing("N1", 0)];
    expect(apply(posts, [], "P3", "P1")).toEqual(["P3", "P1", "P2", "N1"]);
  });

  it("B. 1 veya 2 pinned ile de aynı kural", () => {
    expect(apply([pinned("P1", 0), pinned("P2", 1), existing("N1", 0)], [], "P2", "P1")).toEqual(["P2", "P1", "N1"]);
    expect(apply([pinned("P1", 0), existing("N1", 0)], [], "P1", "N1")).toBeNull();
  });

  it("C. normal → pinned alanına bırakma engellenir, sıra değişmez", () => {
    const posts = [pinned("P1", 0), pinned("P2", 1), existing("N1", 0), existing("N2", 1)];
    expect(reorderGridPosts(posts, [], "N2", "P1")).toBeNull();
    expect(order(posts)).toEqual(["P1", "P2", "N1", "N2"]);
  });

  it("D. pinned → normal alanına bırakma engellenir, sıra değişmez", () => {
    const posts = [pinned("P1", 0), pinned("P2", 1), existing("N1", 0), existing("N2", 1)];
    expect(reorderGridPosts(posts, [], "P1", "N2")).toBeNull();
  });

  it("planlanan ↔ mevcut ve planlanan ↔ pinned engellenir (kaynak korunur)", () => {
    const posts = [pinned("P1", 0), existing("N1", 0)];
    const plans = [planned("L1", 0)];
    expect(reorderGridPosts(posts, plans, "N1", "L1")).toBeNull();
    expect(reorderGridPosts(posts, plans, "L1", "N1")).toBeNull();
    expect(reorderGridPosts(posts, plans, "L1", "P1")).toBeNull();
  });

  it("aynı konum veya bilinmeyen id null döner", () => {
    const posts = [existing("N1", 0), existing("N2", 1)];
    expect(reorderGridPosts(posts, [], "N1", "N1")).toBeNull();
    expect(reorderGridPosts(posts, [], "N1", "yok")).toBeNull();
  });

  it("E. Post + Reel birlikte sıralanır; tür ve oran alanları değişmez", () => {
    const posts = [existing("N1", 0, { postType: "post" }), existing("R1", 1, { postType: "reel", mediaType: "video", videoUrl: "v", coverImageUrl: "c" }), existing("N2", 2, { postType: "post" })];
    const next = reorderGridPosts(posts, [], "R1", "N1")!;
    expect(order(next.existingPosts)).toEqual(["R1", "N1", "N2"]);
    const reel = next.existingPosts.find((post) => post.id === "R1")!;
    expect(reel).toMatchObject({ postType: "reel", mediaType: "video", videoUrl: "v", coverImageUrl: "c" });
  });

  it("F. existing/planned kimlikleri ve dizileri korunur; yalnız sıra alanı değişir", () => {
    const posts = [pinned("P1", 0, 5), existing("N1", 0), existing("N2", 3), existing("N3", 7)];
    const plans = [planned("L1", 0), planned("L2", 1)];

    const movedExisting = reorderGridPosts(posts, plans, "N3", "N1")!;
    expect(movedExisting.plannedPosts).toBe(plans);
    expect(movedExisting.existingPosts.map((post) => post.source)).toEqual(["mevcut", "mevcut", "mevcut", "mevcut"]);
    // Mevcut bölgenin recencyIndex değerleri (0,3,7) yeni sıraya dağıtılır;
    // pinned gönderinin recencyIndex'i ve pin durumu aynı kalır.
    expect(Object.fromEntries(movedExisting.existingPosts.map((post) => [post.id, post.recencyIndex]))).toEqual({ P1: 5, N3: 0, N1: 3, N2: 7 });
    expect(movedExisting.existingPosts.find((post) => post.id === "P1")).toMatchObject({ pinned: true, pinnedOrder: 0 });

    const movedPlanned = reorderGridPosts(posts, plans, "L2", "L1")!;
    expect(movedPlanned.existingPosts).toBe(posts);
    expect(movedPlanned.plannedPosts.map((post) => [post.id, post.source, post.planOrder])).toEqual([["L1", "planlanan", 1], ["L2", "planlanan", 0]]);
  });

  it("tekrar eden eski recencyIndex değerlerinde sıra belirsiz kalmaz", () => {
    const posts = [existing("N1", 0), existing("N2", 0), existing("N3", 0)];
    expect(apply(posts, [], "N3", "N1")).toEqual(["N3", "N1", "N2"]);
  });
});

describe("tek sıra kaynağı: share ve export", () => {
  const posts = [pinned("P1", 0), pinned("P2", 1), existing("N1", 0), existing("N2", 1, { postType: "reel" }), existing("N3", 2)];
  const plans = [planned("L1", 0)];
  const next = reorderGridPosts(posts, plans, "N3", "N1")!;
  const grid = computeGrid(next.existingPosts, next.plannedPosts);
  const expected = ["P1", "P2", "L1", "N3", "N1", "N2"];

  it("M. share snapshot girdisi editördeki yeni sırayı kullanır", () => {
    const input = shareInputFromGrid({ id: "b", name: "Marka", username: "marka" }, grid);
    expect(input.cells.map((cell) => cell.id)).toEqual(expected);
    expect(input.cells.map((cell) => cell.position)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(input.cells.filter((cell) => cell.pinned).map((cell) => cell.id)).toEqual(["P1", "P2"]);
  });

  it("N. export yerleşimi aynı sırayı ve kolonları kullanır", () => {
    expect(grid.cells.map((cell) => cell.post.id)).toEqual(expected);
    const rects = calculateExportCellRects(grid.cells, calculateExportLayout(grid.cells));
    // N3 (4. hücre) ikinci satırın ilk kolonunda; N2 Reel olarak 2:3 kalır.
    expect(rects[3].x).toBe(rects[0].x);
    expect(rects[3].y).toBeGreaterThan(rects[0].y);
    expect(rects[5].reel).toBe(true);
  });
});
