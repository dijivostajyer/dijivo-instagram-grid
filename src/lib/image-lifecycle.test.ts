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
