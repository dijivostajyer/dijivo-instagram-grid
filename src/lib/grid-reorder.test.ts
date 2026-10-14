import { describe, expect, it } from "vitest";

import { computeGrid, orderNormalPosts } from "./grid";
import { canDropInGridZone, gridCellZone, reorderGridPosts, reorderPlannedInGrid } from "./grid-reorder";
import { calculateExportCellRects, calculateExportLayout } from "./export";
import { addExistingPost, addPlannedPost, unpinPost } from "./post-ops";
import { shareInputFromGrid } from "./share";
import type { ExistingPost, PlannedPost, PostType } from "./types";

const existing = (id: string, recencyIndex: number, extra: Partial<ExistingPost> = {}): ExistingPost => ({
  id, source: "mevcut", imageUrl: `https://cdn.test/${id}.jpg`, recencyIndex, pinned: false, ...extra,
});
const pinned = (id: string, pinnedOrder: number, recencyIndex = 100 + pinnedOrder): ExistingPost =>
  existing(id, recencyIndex, { pinned: true, pinnedOrder });
const planned = (id: string, planOrder: number, postType?: PostType, extra: Partial<PlannedPost> = {}): PlannedPost => ({
  id, source: "planlanan", imageUrl: `https://cdn.test/${id}.jpg`, planOrder, postType, ...extra,
});
const order = (existingPosts: ExistingPost[], plannedPosts: PlannedPost[] = []) =>
  computeGrid(existingPosts, plannedPosts).cells.map((cell) => cell.post.id);

function apply(existingPosts: ExistingPost[], plannedPosts: PlannedPost[], activeId: string, overId: string) {
  const next = reorderGridPosts(existingPosts, plannedPosts, activeId, overId);
  return next ? order(next.existingPosts, next.plannedPosts) : null;
}

/** "L1 N1 L2 N2" gibi karma bir başlangıç sırasını gridOrder ile kurar. */
function mixed(ids: string[], pinnedPosts: ExistingPost[] = []) {
  const existingPosts: ExistingPost[] = [...pinnedPosts];
  const plannedPosts: PlannedPost[] = [];
  ids.forEach((id, gridOrder) => {
    if (id.startsWith("L")) plannedPosts.push(planned(id, plannedPosts.length, undefined, { gridOrder }));
    else existingPosts.push(existing(id, existingPosts.length, { gridOrder, postType: id === "N2" ? "reel" : "post" }));
  });
  return { existingPosts, plannedPosts };
}

describe("grid bölgeleri", () => {
  it("yalnız iki bölge: sabitlenmiş ve normal (planlanan + mevcut)", () => {
    const { cells } = computeGrid([pinned("P1", 0), existing("N1", 0)], [planned("L1", 0)]);
    expect(cells.map((cell) => [cell.post.id, gridCellZone(cell)])).toEqual([["P1", "pinned"], ["L1", "normal"], ["N1", "normal"]]);
    expect(canDropInGridZone("pinned", "pinned")).toBe(true);
    expect(canDropInGridZone("normal", "normal")).toBe(true);
    expect(canDropInGridZone("pinned", "normal")).toBe(false);
    expect(canDropInGridZone("normal", "pinned")).toBe(false);
    expect(canDropInGridZone(null, "normal")).toBe(false);
  });
});

describe("ortak normal sıra (orderNormalPosts)", () => {
  it("gridOrder yoksa eski projeler birebir aynı: önce planlananlar, sonra mevcutlar", () => {
    expect(order([existing("N2", 1), existing("N1", 0), pinned("P1", 0)], [planned("L2", 1), planned("L1", 0)]))
      .toEqual(["P1", "L1", "L2", "N1", "N2"]);
  });

  it("gridOrder varsa karma sıra kullanılır", () => {
    const { existingPosts, plannedPosts } = mixed(["N1", "L1", "N2", "L2"]);
    expect(order(existingPosts, plannedPosts)).toEqual(["N1", "L1", "N2", "L2"]);
  });

  it("yeni planlanan gönderi (planOrder 0) planlananların başına, karma sırayı bozmadan eklenir", () => {
    const { existingPosts, plannedPosts } = mixed(["L1", "N1", "L2", "N2"]);
    const withNew = addPlannedPost(plannedPosts, { imageUrl: "x", alt: "L3", postType: "post", aspectRatio: "1:1" }).posts;
    const newId = withNew.find((post) => post.alt === "L3")!.id;
    expect(order(existingPosts, withNew)).toEqual([newId, "L1", "N1", "L2", "N2"]);
  });

  it("'en yeni' mevcut gönderi mevcutların başına, 'en eski' sona eklenir", () => {
    const { existingPosts, plannedPosts } = mixed(["L1", "N1", "L2", "N2"]);
    const newest = addExistingPost(existingPosts, { imageUrl: "x", alt: "NEW", recency: "enYeni", postType: "post", aspectRatio: "1:1" }).posts;
    const newestId = newest.find((post) => post.alt === "NEW")!.id;
    expect(order(newest, plannedPosts)).toEqual(["L1", newestId, "N1", "L2", "N2"]);
    const oldest = addExistingPost(existingPosts, { imageUrl: "x", alt: "OLD", recency: "enEski", postType: "post", aspectRatio: "1:1" }).posts;
    const oldestId = oldest.find((post) => post.alt === "OLD")!.id;
    expect(order(oldest, plannedPosts)).toEqual(["L1", "N1", "L2", "N2", oldestId]);
  });

  it("pin kaldırılan gönderi normal bölgeye döner, diğerlerinin sırası korunur", () => {
    const { existingPosts, plannedPosts } = mixed(["L1", "N1", "N2"], [pinned("P1", 0, 5)]);
    const unpinned = unpinPost(existingPosts, "P1");
    const result = order(unpinned, plannedPosts);
    expect(result.filter((id) => id !== "P1")).toEqual(["L1", "N1", "N2"]);
    expect(result).toContain("P1");
  });

  it("aynı gridOrder değerlerinde eski sıra kararı bozmaz (deterministik)", () => {
    expect(orderNormalPosts([planned("L1", 0, undefined, { gridOrder: 0 })], [existing("N1", 0, { gridOrder: 0 })]).map((post) => post.id)).toEqual(["L1", "N1"]);
  });
});

describe("reorderGridPosts — Faz 2 kuralları korunur", () => {
  it("normal reorder: N3 başa → N3 N1 N2", () => {
    expect(apply([existing("N1", 0), existing("N2", 1), existing("N3", 2)], [], "N3", "N1")).toEqual(["N3", "N1", "N2"]);
  });

  it("planlananlar kendi arasında: L3 başa → L3 L1 L2", () => {
    expect(apply([], [planned("L1", 0), planned("L2", 1), planned("L3", 2)], "L3", "L1")).toEqual(["L3", "L1", "L2"]);
  });

  it("pinned kendi arasında: P3 başa → P3 P1 P2", () => {
    expect(apply([pinned("P1", 0), pinned("P2", 1), pinned("P3", 2), existing("N1", 0)], [], "P3", "P1")).toEqual(["P3", "P1", "P2", "N1"]);
  });

  it("1 veya 2 pinned ile de aynı kural", () => {
    expect(apply([pinned("P1", 0), pinned("P2", 1), existing("N1", 0)], [], "P2", "P1")).toEqual(["P2", "P1", "N1"]);
    expect(apply([pinned("P1", 0), existing("N1", 0)], [], "P1", "N1")).toBeNull();
  });

  it("aynı konum veya bilinmeyen id null döner", () => {
    const posts = [existing("N1", 0), existing("N2", 1)];
    expect(reorderGridPosts(posts, [], "N1", "N1")).toBeNull();
    expect(reorderGridPosts(posts, [], "N1", "yok")).toBeNull();
  });

  it("Post + Reel birlikte sıralanır; tür ve medya alanları değişmez", () => {
    const posts = [existing("N1", 0, { postType: "post" }), existing("R1", 1, { postType: "reel", mediaType: "video", videoUrl: "v", coverImageUrl: "c" }), existing("N2", 2)];
    const next = reorderGridPosts(posts, [], "R1", "N1")!;
    expect(order(next.existingPosts)).toEqual(["R1", "N1", "N2"]);
    expect(next.existingPosts.find((post) => post.id === "R1")).toMatchObject({ postType: "reel", mediaType: "video", videoUrl: "v", coverImageUrl: "c" });
  });

  it("tekrar eden eski recencyIndex değerlerinde sıra belirsiz kalmaz", () => {
    expect(apply([existing("N1", 0), existing("N2", 0), existing("N3", 0)], [], "N3", "N1")).toEqual(["N3", "N1", "N2"]);
  });
});

describe("Faz 2.1 — planlanan ve mevcut tek normal bölgede", () => {
  it("A. L1 N1 L2 N2 → L2'yi N1 önüne → L1 L2 N1 N2", () => {
    const { existingPosts, plannedPosts } = mixed(["L1", "N1", "L2", "N2"]);
    expect(apply(existingPosts, plannedPosts, "L2", "N1")).toEqual(["L1", "L2", "N1", "N2"]);
  });

  it("B. L1 N1 L2 N2 → N2'yi L1 önüne → N2 L1 N1 L2", () => {
    const { existingPosts, plannedPosts } = mixed(["L1", "N1", "L2", "N2"]);
    expect(apply(existingPosts, plannedPosts, "N2", "L1")).toEqual(["N2", "L1", "N1", "L2"]);
  });

  it("eski (gridOrder'sız) projede de planlanan ↔ mevcut taşınabilir", () => {
    expect(apply([existing("N1", 0), existing("N2", 1)], [planned("L1", 0), planned("L2", 1)], "N2", "L1")).toEqual(["N2", "L1", "L2", "N1"]);
  });

  it("C/D. planlanan planlanan, mevcut mevcut kalır; diziler ve kimlikler korunur", () => {
    const { existingPosts, plannedPosts } = mixed(["L1", "N1", "L2", "N2"], [pinned("P1", 0, 9)]);
    const next = reorderGridPosts(existingPosts, plannedPosts, "N2", "L1")!;
    expect(next.plannedPosts.map((post) => [post.id, post.source])).toEqual([["L1", "planlanan"], ["L2", "planlanan"]]);
    expect(next.existingPosts.map((post) => [post.id, post.source])).toEqual([["P1", "mevcut"], ["N1", "mevcut"], ["N2", "mevcut"]]);
    // Sabitlenmiş gönderi dokunulmaz.
    expect(next.existingPosts[0]).toBe(existingPosts[0]);
    // Ortak sıra yazıldı; kaynağa özgü sıralar göreli sırayla tutarlı.
    expect(Object.fromEntries([...next.plannedPosts, ...next.existingPosts.slice(1)].map((post) => [post.id, post.gridOrder]))).toEqual({ N2: 0, L1: 1, N1: 2, L2: 3 });
    expect(next.plannedPosts.map((post) => post.planOrder)).toEqual([0, 1]);
    expect(Object.fromEntries(next.existingPosts.slice(1).map((post) => [post.id, post.recencyIndex]))).toEqual({ N2: 1, N1: 2 });
  });

  it("E. pinned → normal hâlâ engelli", () => {
    const { existingPosts, plannedPosts } = mixed(["L1", "N1"], [pinned("P1", 0), pinned("P2", 1)]);
    expect(reorderGridPosts(existingPosts, plannedPosts, "P1", "N1")).toBeNull();
    expect(reorderGridPosts(existingPosts, plannedPosts, "P2", "L1")).toBeNull();
  });

  it("F. normal → pinned hâlâ engelli", () => {
    const { existingPosts, plannedPosts } = mixed(["L1", "N1"], [pinned("P1", 0), pinned("P2", 1)]);
    expect(reorderGridPosts(existingPosts, plannedPosts, "L1", "P1")).toBeNull();
    expect(reorderGridPosts(existingPosts, plannedPosts, "N1", "P2")).toBeNull();
    expect(order(existingPosts, plannedPosts)).toEqual(["P1", "P2", "L1", "N1"]);
  });

  it("yan panel planlanan sıralaması grid konumlarını korur, mevcutları kaydırmaz", () => {
    const { existingPosts, plannedPosts } = mixed(["L1", "N1", "L2", "N2"]);
    const next = reorderPlannedInGrid(existingPosts, plannedPosts, ["L2", "L1"])!;
    expect(order(next.existingPosts, next.plannedPosts)).toEqual(["L2", "N1", "L1", "N2"]);
    expect(reorderPlannedInGrid(existingPosts, plannedPosts, ["L1"])).toBeNull();
  });
});

describe("tek sıra kaynağı: share ve export", () => {
  const base = mixed(["L1", "N1", "L2", "N2", "N3"], [pinned("P1", 0), pinned("P2", 1)]);
  const next = reorderGridPosts(base.existingPosts, base.plannedPosts, "N3", "L1")!;
  const grid = computeGrid(next.existingPosts, next.plannedPosts);
  const expected = ["P1", "P2", "N3", "L1", "N1", "L2", "N2"];

  it("I. share snapshot girdisi editördeki karma sırayı kullanır", () => {
    const input = shareInputFromGrid({ id: "b", name: "Marka", username: "marka" }, grid);
    expect(input.cells.map((cell) => cell.id)).toEqual(expected);
    expect(input.cells.map((cell) => cell.source)).toEqual(["mevcut", "mevcut", "mevcut", "planlanan", "mevcut", "planlanan", "mevcut"]);
    expect(input.cells.map((cell) => cell.position)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("J. export yerleşimi aynı karma sırayı ve kolonları kullanır", () => {
    expect(grid.cells.map((cell) => cell.post.id)).toEqual(expected);
    const rects = calculateExportCellRects(grid.cells, calculateExportLayout(grid.cells));
    expect(rects[3].x).toBe(rects[0].x); // L1: 2. satır 1. kolon
    expect(rects[3].y).toBeGreaterThan(rects[0].y);
    expect(rects[6].reel).toBe(true); // N2 Reel olarak 2:3 kalır
  });
});
