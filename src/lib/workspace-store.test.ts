import { describe, expect, it, vi } from "vitest";

import { buildStoryRows, reconcileWorkspaceState } from "./workspace-store";
import type { PersistedAppState } from "./storage";

const brand = { id: "brand-a", name: "Brand", username: "brand" };
const project = {
  id: "project-a", name: "Ocak", month: 1, year: 2026,
  createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
  brand, brandId: brand.id,
};

describe("reconcileWorkspaceState", () => {
  it("remote brand/project exists but posts missing: preserves local existing and planned posts", () => {
    const local: PersistedAppState = {
      version: 3, brands: [brand], activeBrandId: brand.id, activeProjectId: project.id, brand,
      existingPosts: [{ id: "existing-1", source: "mevcut", imageUrl: "idb:image", recencyIndex: 0, pinned: true, pinnedOrder: 0, caption: "Mevcut" }],
      plannedPosts: [{ id: "planned-1", source: "planlanan", imageUrl: "idb:planned", planOrder: 0, caption: "Plan" }],
      projects: [{ ...project, existingPosts: [{ id: "existing-1", source: "mevcut", imageUrl: "idb:image", recencyIndex: 0, pinned: true, pinnedOrder: 0, caption: "Mevcut" }], plannedPosts: [{ id: "planned-1", source: "planlanan", imageUrl: "idb:planned", planOrder: 0, caption: "Plan" }] }],
    };
    const remote: PersistedAppState = { ...local, existingPosts: [], plannedPosts: [], projects: [{ ...project, existingPosts: [], plannedPosts: [] }] };

    const reconciled = reconcileWorkspaceState(remote, local);

    expect(reconciled.projects?.[0].existingPosts).toHaveLength(1);
    expect(reconciled.projects?.[0].plannedPosts).toHaveLength(1);
    expect(reconciled.projects?.[0].existingPosts[0]).toMatchObject({ source: "mevcut", pinned: true, caption: "Mevcut" });
    expect(reconciled.projects?.[0].plannedPosts[0]).toMatchObject({ source: "planlanan", planOrder: 0, caption: "Plan" });
  });
});

describe("buildStoryRows", () => {
  const story = (id: string, mediaUrl: string) => ({ id, mediaType: "image" as const, mediaUrl, createdAt: "2026-10-01T00:00:00.000Z", sortOrder: 0 });

  it("her Story satırını kendi projesinin project_id'si ile yazar", () => {
    const rows = buildStoryRows("user-1", [
      { ...project, id: "p-sep", month: 9, existingPosts: [], plannedPosts: [], stories: [story("s-sep", "storage:workspace-media/user-1/brand-a/story/a.jpg")] },
      { ...project, id: "p-oct", month: 10, existingPosts: [], plannedPosts: [], stories: [story("s-oct", "storage:workspace-media/user-1/brand-a/story/b.jpg")] },
    ]);
    expect(rows.map((row) => [row.id, row.project_id, row.brand_id, row.media_path])).toEqual([
      ["s-sep", "p-sep", "brand-a", "user-1/brand-a/story/a.jpg"],
      ["s-oct", "p-oct", "brand-a", "user-1/brand-a/story/b.jpg"],
    ]);
  });

  it("Storage'a bağlanmamış medyayı (blob/imzalı URL) asla yazmaz", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const rows = buildStoryRows("user-1", [
      { ...project, existingPosts: [], plannedPosts: [], stories: [story("s-blob", "blob:https://app.test/x"), story("s-url", "https://cdn.example.test/x.jpg")] },
    ]);
    expect(rows).toEqual([]);
    warn.mockRestore();
  });
});
