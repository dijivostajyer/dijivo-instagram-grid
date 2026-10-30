import { describe, expect, it } from "vitest";

import { collectSyncedIds, computeRemovedIds, readSyncClean, shouldTrustRemote, workspaceSignature, writeSyncClean } from "./workspace-sync";
import type { PersistedAppState, StorageLike } from "./storage";
import type { Brand, ExistingPost, PlannedPost } from "./types";

const brand: Brand = { id: "b1", name: "Marka", username: "marka", highlights: [{ id: "h1", title: "Öne çıkan", imageUrl: "storage:workspace-media/u/b1/h.jpg" }] };
const existing = (id: string, extra: Partial<ExistingPost> = {}): ExistingPost => ({ id, source: "mevcut", imageUrl: `storage:workspace-media/u/${id}.jpg`, recencyIndex: 0, pinned: false, ...extra });
const planned = (id: string): PlannedPost => ({ id, source: "planlanan", imageUrl: `storage:workspace-media/u/${id}.jpg`, planOrder: 0 });

function state(posts: ExistingPost[], plans: PlannedPost[] = []): PersistedAppState {
  const project = { id: "p1", name: "Ekim", month: 10, year: 2026, createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z", brand, brandId: "b1", existingPosts: posts, plannedPosts: plans };
  return { version: 3, brand, brands: [brand], existingPosts: posts, plannedPosts: plans, projects: [project], activeBrandId: "b1", activeProjectId: "p1" };
}

function memoryStorage(): StorageLike {
  const map = new Map<string, string>();
  return { getItem: (key) => map.get(key) ?? null, setItem: (key, value) => void map.set(key, value), removeItem: (key) => void map.delete(key) };
}

describe("cihazlar arası silme yayılımı", () => {
  it("önceki eşitlemede olup şimdi olmayan gönderi/öne çıkan kimlikleri silinecek olarak bulunur", () => {
    const before = collectSyncedIds(state([existing("a"), existing("b")], [planned("c")]));
    const after = collectSyncedIds({ ...state([existing("a")]), brands: [{ ...brand, highlights: [] }] });
    expect(computeRemovedIds(before, after)).toEqual({ postIds: ["b", "c"], highlightIds: ["h1"] });
  });

  it("değişmeyen durumda silinecek kayıt yoktur", () => {
    const synced = collectSyncedIds(state([existing("a")]));
    expect(computeRemovedIds(synced, collectSyncedIds(state([existing("a")])))).toEqual({ postIds: [], highlightIds: [] });
  });
});

describe("açılışta uzak veriye güven", () => {
  it("yalnız son eşitleme temiz bitmişse uzak veri tek kaynaktır; bilinmeyen/kirli durumda birleştirilir", () => {
    expect(shouldTrustRemote(true)).toBe(true);
    expect(shouldTrustRemote(false)).toBe(false);
    expect(shouldTrustRemote(null)).toBe(false);
  });

  it("temiz işareti kullanıcı bazında saklanır", () => {
    const storage = memoryStorage();
    expect(readSyncClean(storage, "u1")).toBeNull();
    writeSyncClean(storage, "u1", false);
    expect(readSyncClean(storage, "u1")).toBe(false);
    writeSyncClean(storage, "u1", true);
    expect(readSyncClean(storage, "u1")).toBe(true);
    expect(readSyncClean(storage, "u2")).toBeNull();
  });
});

describe("workspaceSignature", () => {
  const canonical = (url: string) => url.replace(/\?token=.*$/, "");

  it("yalnız imzalı URL süresi yenilenmişse imza değişmez", () => {
    const a = state([existing("a", { imageUrl: "https://x.test/obj.jpg?token=1" })]);
    const b = state([existing("a", { imageUrl: "https://x.test/obj.jpg?token=2" })]);
    expect(workspaceSignature(a, canonical)).toBe(workspaceSignature(b, canonical));
  });

  it("başka cihazda değişen caption (satır sonları dahil) ve silinen gönderi fark edilir", () => {
    const base = state([existing("a", { caption: "Bir\nİki" }), existing("b")]);
    expect(workspaceSignature(base, canonical)).not.toBe(workspaceSignature(state([existing("a", { caption: "Bir\n\nİki" }), existing("b")]), canonical));
    expect(workspaceSignature(base, canonical)).not.toBe(workspaceSignature(state([existing("a", { caption: "Bir\nİki" })]), canonical));
  });

  it("aktif marka/proje seçimi cihaza özgüdür; imzayı etkilemez", () => {
    const a = state([existing("a")]);
    expect(workspaceSignature({ ...a, activeProjectId: "baska" }, canonical)).toBe(workspaceSignature(a, canonical));
  });
});
