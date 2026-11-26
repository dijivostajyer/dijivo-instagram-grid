import { describe, expect, it, vi } from "vitest";

import { makeImageRef } from "./image-store";
import {
  cleanUpRemovedImages,
  revokeTrackedObjectUrls,
} from "./image-lifecycle";
import { STORAGE_VERSION, type PersistedAppState } from "./storage";

function state(overrides: Partial<PersistedAppState> = {}): PersistedAppState {
  return {
    version: STORAGE_VERSION,
    brand: { id: "brand", name: "Marka", username: "marka" },
    existingPosts: [],
    plannedPosts: [],
    ...overrides,
  };
}

describe("persisted image lifecycle cleanup", () => {
  it("HTTP demo görseli silinince IndexedDB delete çağırmaz", async () => {
    const removeStoredImage = vi.fn(async () => undefined);
    const revokeObjectUrl = vi.fn();
    await cleanUpRemovedImages({
      previousState: state({
        existingPosts: [{
          id: "demo",
          source: "mevcut",
          imageUrl: "https://example.com/demo.jpg",
          recencyIndex: 0,
          pinned: false,
        }],
      }),
      nextState: state(),
      refByObjectUrl: new Map(),
      trackedObjectUrls: new Set(),
      revokeObjectUrl,
      deleteStoredImage: removeStoredImage,
    });

    expect(removeStoredImage).not.toHaveBeenCalled();
    expect(revokeObjectUrl).not.toHaveBeenCalled();
  });

  it("silinen upload için idb referansını bulur, mapping'i çıkarır ve URL'i revoke eder", async () => {
    const objectUrl = "blob:https://app.test/uploaded-post";
    const ref = makeImageRef("uploaded-post");
    const refs = new Map([[objectUrl, ref]]);
    const tracked = new Set([objectUrl]);
    const removeStoredImage = vi.fn(async () => undefined);
    const revokeObjectUrl = vi.fn();

    await cleanUpRemovedImages({
      previousState: state({
        plannedPosts: [{
          id: "upload",
          source: "planlanan",
          imageUrl: objectUrl,
          planOrder: 0,
        }],
      }),
      nextState: state(),
      refByObjectUrl: refs,
      trackedObjectUrls: tracked,
      revokeObjectUrl,
      deleteStoredImage: removeStoredImage,
    });

    expect(removeStoredImage).toHaveBeenCalledWith(ref);
    expect(revokeObjectUrl).toHaveBeenCalledWith(objectUrl);
    expect(refs.has(objectUrl)).toBe(false);
    expect(tracked.has(objectUrl)).toBe(false);
  });

  it("aynı kalıcı ref hâlâ kullanımdayken Blob'u silmez", async () => {
    const removedUrl = "blob:https://app.test/old-profile";
    const activeUrl = "blob:https://app.test/active-post";
    const ref = makeImageRef("shared-image");
    const removeStoredImage = vi.fn(async () => undefined);

    await cleanUpRemovedImages({
      previousState: state({
        brand: {
          id: "brand",
          name: "Marka",
          username: "marka",
          profileImageUrl: removedUrl,
        },
        plannedPosts: [{
          id: "still-active",
          source: "planlanan",
          imageUrl: activeUrl,
          planOrder: 0,
        }],
      }),
      nextState: state({
        plannedPosts: [{
          id: "still-active",
          source: "planlanan",
          imageUrl: activeUrl,
          planOrder: 0,
        }],
      }),
      refByObjectUrl: new Map([
        [removedUrl, ref],
        [activeUrl, ref],
      ]),
      trackedObjectUrls: new Set([removedUrl, activeUrl]),
      revokeObjectUrl: vi.fn(),
      deleteStoredImage: removeStoredImage,
    });

    expect(removeStoredImage).not.toHaveBeenCalled();
  });

  it("başka projede kullanılan ref silinmez; son proje de bırakınca silinir", async () => {
    const objectUrl = "blob:https://app.test/cross-project";
    const ref = makeImageRef("cross-project");
    const project = {
      id: "project-b", name: "B", month: 2, year: 2026, createdAt: "2026-02-01T00:00:00.000Z", updatedAt: "2026-02-01T00:00:00.000Z",
      brand: { id: "brand-b", name: "B", username: "b" }, existingPosts: [], plannedPosts: [{ id: "b-post", source: "planlanan" as const, imageUrl: objectUrl, planOrder: 0 }],
    };
    const removeStoredImage = vi.fn(async () => undefined);
    const previous = state({ plannedPosts: [{ id: "a-post", source: "planlanan", imageUrl: objectUrl, planOrder: 0 }], projects: [project] });
    await cleanUpRemovedImages({ previousState: previous, nextState: state({ projects: [project] }), refByObjectUrl: new Map([[objectUrl, ref]]), trackedObjectUrls: new Set([objectUrl]), revokeObjectUrl: vi.fn(), deleteStoredImage: removeStoredImage });
    expect(removeStoredImage).not.toHaveBeenCalled();
    await cleanUpRemovedImages({ previousState: state({ projects: [project] }), nextState: state(), refByObjectUrl: new Map([[objectUrl, ref]]), trackedObjectUrls: new Set([objectUrl]), revokeObjectUrl: vi.fn(), deleteStoredImage: removeStoredImage });
    expect(removeStoredImage).toHaveBeenCalledWith(ref);
  });

  it("reset veya unmount sonrası takip edilen bütün object URL'leri revoke eder", () => {
    const first = "blob:https://app.test/first";
    const second = "blob:https://app.test/second";
    const refs = new Map([[first, makeImageRef("first")]]);
    const tracked = new Set([first, second]);
    const revokeObjectUrl = vi.fn();

    revokeTrackedObjectUrls({
      refByObjectUrl: refs,
      trackedObjectUrls: tracked,
      revokeObjectUrl,
    });

    expect(revokeObjectUrl).toHaveBeenCalledWith(first);
    expect(revokeObjectUrl).toHaveBeenCalledWith(second);
    expect(refs.size).toBe(0);
    expect(tracked.size).toBe(0);
  });

  it("cleanup hataları UI akışını kesmez", async () => {
    const objectUrl = "blob:https://app.test/failing";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      await expect(
        cleanUpRemovedImages({
          previousState: state({
            existingPosts: [{
              id: "upload",
              source: "mevcut",
              imageUrl: objectUrl,
              recencyIndex: 0,
              pinned: false,
            }],
          }),
          nextState: state(),
          refByObjectUrl: new Map([[objectUrl, makeImageRef("failing")]]),
          trackedObjectUrls: new Set([objectUrl]),
          revokeObjectUrl: () => {
            throw new Error("revoke failed");
          },
          deleteStoredImage: async () => {
            throw new Error("delete failed");
          },
        }),
      ).resolves.toBeUndefined();
      expect(warn).toHaveBeenCalledTimes(2);
    } finally {
      warn.mockRestore();
    }
  });
});

describe("Reel kapak ve video temizliği (R2)", () => {
  it("state'ten çıkan kapak görseli revoke edilir ve görsel deposundan silinir", async () => {
    const coverUrl = "blob:https://app.test/cover";
    const coverRef = makeImageRef("cover-1");
    const refs = new Map([[coverUrl, coverRef]]);
    const removeStoredImage = vi.fn(async () => undefined);
    const revokeObjectUrl = vi.fn();
    const post = {
      id: "r", source: "mevcut" as const, imageUrl: "https://cdn.test/poster.jpg", recencyIndex: 0, pinned: false,
      postType: "reel" as const, coverImageUrl: coverUrl,
    };
    await cleanUpRemovedImages({
      previousState: state({ existingPosts: [post] }),
      nextState: state({ existingPosts: [{ ...post, coverImageUrl: undefined }] }),
      refByObjectUrl: refs,
      trackedObjectUrls: new Set([coverUrl]),
      revokeObjectUrl,
      deleteStoredImage: removeStoredImage,
    });
    expect(revokeObjectUrl).toHaveBeenCalledWith(coverUrl);
    expect(removeStoredImage).toHaveBeenCalledWith(coverRef);
  });

  it("kaldırılan video video deposundan silinir; görsel deposuna dokunulmaz", async () => {
    const videoUrl = "blob:https://app.test/video";
    const videoRef = "idb-video:v-1";
    const refs = new Map([[videoUrl, videoRef]]);
    const removeStoredImage = vi.fn(async () => undefined);
    const removeStoredVideo = vi.fn(async () => undefined);
    const revokeObjectUrl = vi.fn();
    const post = {
      id: "r", source: "planlanan" as const, imageUrl: "https://cdn.test/poster.jpg", planOrder: 0,
      postType: "reel" as const, mediaType: "video" as const, videoUrl,
    };
    await cleanUpRemovedImages({
      previousState: state({ plannedPosts: [post] }),
      nextState: state({ plannedPosts: [{ ...post, videoUrl: undefined, mediaType: undefined }] }),
      refByObjectUrl: refs,
      trackedObjectUrls: new Set([videoUrl]),
      revokeObjectUrl,
      deleteStoredImage: removeStoredImage,
      deleteStoredVideo: removeStoredVideo,
    });
    expect(revokeObjectUrl).toHaveBeenCalledWith(videoUrl);
    expect(removeStoredVideo).toHaveBeenCalledWith(videoRef);
    expect(removeStoredImage).not.toHaveBeenCalled();
  });

  it("hâlâ kullanılan video ve kapak silinmez", async () => {
    const videoUrl = "blob:https://app.test/video";
    const coverUrl = "blob:https://app.test/cover";
    const refs = new Map([[videoUrl, "idb-video:v-1"], [coverUrl, makeImageRef("c-1")]]);
    const removeStoredImage = vi.fn(async () => undefined);
    const removeStoredVideo = vi.fn(async () => undefined);
    const revokeObjectUrl = vi.fn();
    const post = {
      id: "r", source: "mevcut" as const, imageUrl: coverUrl, recencyIndex: 0, pinned: false,
      postType: "reel" as const, mediaType: "video" as const, videoUrl, coverImageUrl: coverUrl,
    };
    await cleanUpRemovedImages({
      previousState: state({ existingPosts: [post] }),
      nextState: state({ existingPosts: [{ ...post, caption: "yeni açıklama" }] }),
      refByObjectUrl: refs,
      trackedObjectUrls: new Set([videoUrl, coverUrl]),
      revokeObjectUrl,
      deleteStoredImage: removeStoredImage,
      deleteStoredVideo: removeStoredVideo,
    });
    expect(revokeObjectUrl).not.toHaveBeenCalled();
    expect(removeStoredImage).not.toHaveBeenCalled();
    expect(removeStoredVideo).not.toHaveBeenCalled();
  });
});

describe("paylaşılan video referansı (R2 denetimi)", () => {
  it("aynı video başka projedeki kopyada hâlâ kullanılıyorsa silinmez; son kullanıcı bırakınca silinir", async () => {
    const urlA = "blob:https://app.test/video-a";
    const urlB = "blob:https://app.test/video-b";
    const ref = "idb-video:shared-1";
    const refs = new Map([[urlA, ref], [urlB, ref]]);
    const removeStoredVideo = vi.fn(async () => undefined);
    const reelIn = (id: string, videoUrl: string | undefined) => ({
      id, source: "mevcut" as const, imageUrl: "https://cdn.test/p.jpg", recencyIndex: 0, pinned: false,
      postType: "reel" as const, mediaType: videoUrl ? ("video" as const) : undefined, videoUrl,
    });
    const project = (id: string, videoUrl: string | undefined) => ({
      id, name: id, month: 1, year: 2026, createdAt: "", updatedAt: "",
      brand: { id: "brand", name: "Marka", username: "marka" }, existingPosts: [reelIn(`${id}-r`, videoUrl)], plannedPosts: [],
    });
    const both = state({ projects: [project("p1", urlA), project("p2", urlB)] });
    const onlyB = state({ projects: [project("p1", undefined), project("p2", urlB)] });
    const none = state({ projects: [project("p1", undefined), project("p2", undefined)] });

    await cleanUpRemovedImages({ previousState: both, nextState: onlyB, refByObjectUrl: refs, trackedObjectUrls: new Set([urlA, urlB]), revokeObjectUrl: vi.fn(), deleteStoredVideo: removeStoredVideo });
    expect(removeStoredVideo).not.toHaveBeenCalled();

    await cleanUpRemovedImages({ previousState: onlyB, nextState: none, refByObjectUrl: refs, trackedObjectUrls: new Set([urlB]), revokeObjectUrl: vi.fn(), deleteStoredVideo: removeStoredVideo });
    expect(removeStoredVideo).toHaveBeenCalledWith(ref);
  });
});
