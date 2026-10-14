import { describe, expect, it } from "vitest";

import { addStoryToProject, isStoryMediaReferenced, removeStoryFromProject, replaceStoryMedia } from "./story-ops";
import { gridCellAspectClass } from "./grid-ratio";
import { STORAGE_VERSION, type GridProject, type PersistedAppState } from "./storage";
import type { Story } from "./types";

const brand = { id: "brand-a", name: "Marka", username: "marka" };
const story = (id: string, mediaUrl: string, sortOrder: number): Story => ({ id, mediaType: "image", mediaUrl, createdAt: "2026-10-01T00:00:00.000Z", sortOrder });
const project = (id: string, month: number, stories: Story[]): GridProject => ({
  id, name: id, month, year: 2026, createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z",
  brandId: brand.id, brand, existingPosts: [], plannedPosts: [], stories,
});
const state = (projects: GridProject[]): PersistedAppState => ({
  version: STORAGE_VERSION, brand, brands: [brand], activeBrandId: brand.id, projects, activeProjectId: projects[0].id, existingPosts: [], plannedPosts: [],
});

describe("story-ops", () => {
  it("Story yalnız hedef aya eklenir ve sıraya göre sona yerleşir", () => {
    const next = addStoryToProject(state([project("eylul", 9, [story("e1", "a", 0)]), project("ekim", 10, [story("k1", "b", 0)])]), "ekim", { id: "k2", mediaType: "video", mediaUrl: "c", createdAt: "2026-10-02T00:00:00.000Z" })!;
    expect(next.projects![0].stories!.map((item) => item.id)).toEqual(["e1"]);
    expect(next.projects![1].stories!.map((item) => [item.id, item.sortOrder])).toEqual([["k1", 0], ["k2", 1]]);
  });

  it("silme yalnız seçili Story'yi kaldırır ve sırayı yeniden numaralar", () => {
    const next = removeStoryFromProject(state([project("ekim", 10, [story("a", "1", 0), story("b", "2", 1), story("c", "3", 2)]), project("kasim", 11, [story("b", "x", 0)])]), "ekim", "b")!;
    expect(next.projects![0].stories!.map((item) => [item.id, item.sortOrder])).toEqual([["a", 0], ["c", 1]]);
    expect(next.projects![1].stories!.map((item) => item.id)).toEqual(["b"]);
  });

  it("bilinmeyen proje veya Story için null döner", () => {
    const current = state([project("ekim", 10, [])]);
    expect(addStoryToProject(current, "yok", { id: "x", mediaType: "image", mediaUrl: "m", createdAt: "" })).toBeNull();
    expect(replaceStoryMedia(current, "ekim", "yok", "m")).toBeNull();
  });

  it("medya başka bir ayda kullanılıyorsa referanslı sayılır", () => {
    const current = state([project("ekim", 10, []), project("kasim", 11, [story("k", "shared", 0)])]);
    expect(isStoryMediaReferenced(current, "shared", (value) => value)).toBe(true);
    const detached = replaceStoryMedia(current, "kasim", "k", "own")!;
    expect(isStoryMediaReferenced(detached, "shared", (value) => value)).toBe(false);
  });
});

describe("grid-ratio", () => {
  it("Post 3:4, Reel 2:3", () => {
    expect(gridCellAspectClass("post")).toBe("aspect-[3/4]");
    expect(gridCellAspectClass("carousel")).toBe("aspect-[3/4]");
    expect(gridCellAspectClass(undefined)).toBe("aspect-[3/4]");
    expect(gridCellAspectClass("reel")).toBe("aspect-[2/3]");
  });
});
