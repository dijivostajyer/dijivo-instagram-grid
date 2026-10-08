import { describe, expect, it } from "vitest";

import { reconcileWorkspaceState } from "./workspace-store";
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
