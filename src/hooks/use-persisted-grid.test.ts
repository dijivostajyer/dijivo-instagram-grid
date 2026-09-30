import { describe, expect, it, vi } from "vitest";

vi.mock("../lib/image-store", () => ({
  isImageRef: (value: string) => value.startsWith("idb:"),
  loadImageAsObjectUrl: vi.fn(async (ref: string) => `blob:https://app.test/${ref.slice(4)}`),
  persistObjectUrl: vi.fn(), clearStoredImages: vi.fn(), deleteStoredImage: vi.fn(),
}));

import { hydrateState } from "./use-persisted-grid";
import { STORAGE_VERSION, type PersistedAppState } from "../lib/storage";

describe("multi-project hydration", () => {
  it("tüm projelerdeki idb görsellerini object URL'e çözer ve ortak ref'i paylaşır", async () => {
    const ref = "idb:shared";
    const state: PersistedAppState = {
      version: STORAGE_VERSION, activeProjectId: "a",
      brand: { id: "brand-a", name: "A", username: "a", profileImageUrl: ref, highlights: [{ id: "ha", title: "A", imageUrl: ref }] },
      existingPosts: [{ id: "a-post", source: "mevcut", imageUrl: ref, recencyIndex: 0, pinned: false }], plannedPosts: [],
      projects: [
        { id: "a", name: "A", month: 9, year: 2026, createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z", brand: { id: "brand-a", name: "A", username: "a", profileImageUrl: ref }, existingPosts: [], plannedPosts: [] },
        { id: "b", name: "B", month: 10, year: 2026, createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z", brand: { id: "brand-b", name: "B", username: "b", highlights: [{ id: "hb", title: "B", imageUrl: ref }] }, existingPosts: [], plannedPosts: [{ id: "b-post", source: "planlanan", imageUrl: ref, planOrder: 0 }] },
      ],
    };
    const refs = new Map<string, string>();
    const hydrated = await hydrateState(state, refs, new Set());
    expect(JSON.stringify(hydrated)).not.toContain("idb:");
    expect(hydrated.projects?.[1].plannedPosts[0].imageUrl).toBe("blob:https://app.test/shared");
    expect(hydrated.projects?.[1].brand.highlights?.[0].imageUrl).toBe("blob:https://app.test/shared");
    expect(refs.size).toBe(1);
  });
});
