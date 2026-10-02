import { describe, expect, it, vi } from "vitest";

vi.mock("../lib/image-store", () => ({
  isImageRef: (value: string) => value.startsWith("idb:"),
  loadImageAsObjectUrl: vi.fn(async (ref: string) => `blob:https://app.test/${ref.slice(4)}`),
  persistObjectUrl: vi.fn(), clearStoredImages: vi.fn(), deleteStoredImage: vi.fn(),
}));

vi.mock("../lib/video-store", () => ({
  isVideoRef: (value: string) => value.startsWith("idb-video:"),
  loadVideoAsObjectUrl: vi.fn(async (ref: string) => `blob:https://app.test/${ref.slice(10)}`),
  persistVideoObjectUrl: vi.fn(), clearStoredVideos: vi.fn(), deleteStoredVideo: vi.fn(),
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

describe("reel video hydration (§5/§6)", () => {
  it("reel post'un video ve kapak referanslarını object URL'e çözer", async () => {
    const state: PersistedAppState = {
      version: STORAGE_VERSION, activeProjectId: undefined,
      brand: { id: "b", name: "B", username: "b" },
      existingPosts: [{
        id: "reel-1", source: "mevcut", imageUrl: "idb:img1", recencyIndex: 0, pinned: false,
        mediaType: "video", videoUrl: "idb-video:v1", coverImageUrl: "idb:cover1",
        caption: "Merhaba",
      }],
      plannedPosts: [],
    };
    const refs = new Map<string, string>();
    const hydrated = await hydrateState(state, refs, new Set());
    const post = hydrated.existingPosts[0];
    expect(post.imageUrl).toBe("blob:https://app.test/img1");
    expect(post.videoUrl).toBe("blob:https://app.test/v1");
    expect(post.coverImageUrl).toBe("blob:https://app.test/cover1");
    // Caption hiçbir noktada kaybolmaz (§12).
    expect(post.caption).toBe("Merhaba");
    expect(refs.size).toBe(3);
  });

  it("planlanan reel'in video referansı da çözülür", async () => {
    const state: PersistedAppState = {
      version: STORAGE_VERSION, activeProjectId: undefined,
      brand: { id: "b", name: "B", username: "b" },
      existingPosts: [],
      plannedPosts: [{
        id: "reel-p", source: "planlanan", imageUrl: "idb:imgp", planOrder: 0,
        mediaType: "video", videoUrl: "idb-video:vp", coverImageUrl: "idb:coverp",
      }],
    };
    const hydrated = await hydrateState(state, new Map(), new Set());
    const post = hydrated.plannedPosts[0];
    expect(post.videoUrl).toBe("blob:https://app.test/vp");
    expect(post.coverImageUrl).toBe("blob:https://app.test/coverp");
  });

  it("proje içindeki reel de çözülür", async () => {
    const state: PersistedAppState = {
      version: STORAGE_VERSION, activeProjectId: "a",
      brand: { id: "b", name: "B", username: "b" },
      // syncActiveProject mirror'ı: aktif projenin postları üst
      // düzey state ile overwrite edilir; reel ikisinde de bulunmalı.
      existingPosts: [{
        id: "reel-x", source: "mevcut", imageUrl: "idb:imgx", recencyIndex: 0, pinned: false,
        mediaType: "video", videoUrl: "idb-video:vx",
      }],
      plannedPosts: [],
      projects: [{
        id: "a", name: "A", month: 10, year: 2026,
        createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z",
        brand: { id: "b", name: "B", username: "b" },
        existingPosts: [{
          id: "reel-x", source: "mevcut", imageUrl: "idb:imgx", recencyIndex: 0, pinned: false,
          mediaType: "video", videoUrl: "idb-video:vx",
        }],
        plannedPosts: [],
      }],
    };
    const hydrated = await hydrateState(state, new Map(), new Set());
    expect(hydrated.projects?.[0].existingPosts[0].videoUrl).toBe("blob:https://app.test/vx");
  });

  it("legacy image post'ta video/kapak alanları tanımsız kalır", async () => {
    const state: PersistedAppState = {
      version: STORAGE_VERSION, activeProjectId: undefined,
      brand: { id: "b", name: "B", username: "b" },
      existingPosts: [{ id: "p", source: "mevcut", imageUrl: "idb:img", recencyIndex: 0, pinned: false }],
      plannedPosts: [],
    };
    const hydrated = await hydrateState(state, new Map(), new Set());
    const post = hydrated.existingPosts[0];
    expect(post.imageUrl).toBe("blob:https://app.test/img");
    expect(post.videoUrl).toBeUndefined();
    expect(post.coverImageUrl).toBeUndefined();
    expect(post.mediaType).toBeUndefined();
  });

  it("video referansı çözülemeyen eski reel kaydı video olmadan açılır (§4/§5)", async () => {
    vi.mocked(await import("../lib/video-store")).loadVideoAsObjectUrl.mockResolvedValueOnce(null);
    const state: PersistedAppState = {
      version: STORAGE_VERSION, activeProjectId: undefined,
      brand: { id: "b", name: "B", username: "b" },
      existingPosts: [{
        id: "reel-old", source: "mevcut", imageUrl: "idb:old", recencyIndex: 0, pinned: false,
        mediaType: "video", videoUrl: "idb-video:silinmis",
      }],
      plannedPosts: [],
    };
    const hydrated = await hydrateState(state, new Map(), new Set());
    const post = hydrated.existingPosts[0];
    // Post düşmez; yalnızca video alanı eksik kalır.
    expect(post.imageUrl).toBe("blob:https://app.test/old");
    expect(post.videoUrl).toBeUndefined();
    // Diğer reel'ler hâlâ çözülür (tek seferlik mock).
    const again = await hydrateState(
      { ...state, existingPosts: [{ ...state.existingPosts[0], id: "reel-old-2" }] },
      new Map(),
      new Set(),
    );
    expect(again.existingPosts[0].videoUrl).toBe("blob:https://app.test/silinmis");
  });
});
