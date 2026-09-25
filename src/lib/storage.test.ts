import { describe, expect, it } from "vitest";

import { computeGrid } from "./grid";
import { imageRefId, isImageRef, makeImageRef } from "./image-store";
import {
  clearPersistedState,
  deserializeAppState,
  loadAppState,
  readPersistedState,
  serializeAppState,
  STORAGE_KEY,
  STORAGE_VERSION,
  toPersistableState,
  writePersistedState,
  type PersistedAppState,
  type StorageLike,
} from "./storage";
import type { Brand, ExistingPost, PlannedPost } from "./types";

function memoryStorage(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
}

const BRAND: Brand = {
  id: "marka-1",
  name: "Marka Adı!",
  username: "marka.tr",
  profileImageUrl: "https://example.com/avatar.png",
  bio: "Açıklama",
};

function existing(overrides: Partial<ExistingPost> = {}): ExistingPost {
  return {
    id: "e1",
    source: "mevcut",
    imageUrl: "https://example.com/e1.jpg",
    recencyIndex: 0,
    pinned: false,
    ...overrides,
  };
}

function planned(overrides: Partial<PlannedPost> = {}): PlannedPost {
  return {
    id: "p1",
    source: "planlanan",
    imageUrl: "https://example.com/p1.jpg",
    planOrder: 0,
    ...overrides,
  };
}

function sampleState(): PersistedAppState {
  return {
    version: STORAGE_VERSION,
    brand: { ...BRAND },
    existingPosts: [
      existing({ id: "e-new", recencyIndex: 0, pinned: true, pinnedOrder: 1 }),
      existing({ id: "e-pin", recencyIndex: 3, pinned: true, pinnedOrder: 0 }),
      existing({ id: "e-old", recencyIndex: 5 }),
    ],
    // Dizi sırası bilerek bozuk; kalıcılık diziyi aynen korumalı.
    plannedPosts: [
      planned({ id: "p-second", planOrder: 1 }),
      planned({ id: "p-first", planOrder: 0 }),
    ],
  };
}

describe("serialize / deserialize", () => {
  it("roundtrip marka, gönderi ve tüm alanları korur", () => {
    const state = sampleState();
    const restored = deserializeAppState(serializeAppState(state));
    expect(restored).toEqual(state);
  });

  it("şema sürümünü yazır ve okur", () => {
    const json = serializeAppState(sampleState());
    expect(JSON.parse(json).version).toBe(STORAGE_VERSION);
    expect(deserializeAppState(json)?.version).toBe(STORAGE_VERSION);
  });
});

describe("corrupted / mismatched data fallback", () => {
  it("geçersiz JSON null döner", () => {
    expect(deserializeAppState("{bozuk json")).toBeNull();
    expect(deserializeAppState("[]")).toBeNull();
    expect(deserializeAppState("null")).toBeNull();
    expect(deserializeAppState("")).toBeNull();
    expect(deserializeAppState(null)).toBeNull();
    expect(deserializeAppState(undefined)).toBeNull();
  });

  it("yanlış sürüm null döner (şema versiyonlama)", () => {
    const json = serializeAppState(sampleState());
    const bumped = JSON.parse(json) as Record<string, unknown>;
    bumped.version = STORAGE_VERSION + 1;
    expect(deserializeAppState(JSON.stringify(bumped))).toBeNull();

    const stringVersion = JSON.parse(json) as Record<string, unknown>;
    stringVersion.version = String(STORAGE_VERSION);
    expect(deserializeAppState(JSON.stringify(stringVersion))).toBeNull();
  });

  it("eksik/bozuk şekil null döner", () => {
    expect(
      deserializeAppState(
        JSON.stringify({ version: STORAGE_VERSION, brand: 42 }),
      ),
    ).toBeNull();
    expect(
      deserializeAppState(
        JSON.stringify({
          version: STORAGE_VERSION,
          brand: BRAND,
          existingPosts: "yok",
          plannedPosts: [],
        }),
      ),
    ).toBeNull();
    expect(
      deserializeAppState(
        JSON.stringify({
          version: STORAGE_VERSION,
          brand: BRAND,
          existingPosts: [{ id: "x" }],
          plannedPosts: [],
        }),
      ),
    ).toBeNull();
    expect(
      deserializeAppState(
        JSON.stringify({
          version: STORAGE_VERSION,
          brand: { ...BRAND, id: 1 },
          existingPosts: [],
          plannedPosts: [],
        }),
      ),
    ).toBeNull();
  });

  it("bozuk veride loadAppState demo varsayılanlarına döner", () => {
    const storage = memoryStorage();
    const defaults = sampleState();
    storage.setItem(STORAGE_KEY, "bozuk-json");
    expect(loadAppState(storage, defaults)).toEqual(defaults);

    storage.setItem(STORAGE_KEY, JSON.stringify({ version: 999 }));
    expect(loadAppState(storage, defaults)).toEqual(defaults);
  });
});

describe("default state fallback ve reset", () => {
  it("ilk açılışta (boş depo) varsayılanlar kullanılır", () => {
    const defaults = sampleState();
    expect(loadAppState(memoryStorage(), defaults)).toEqual(defaults);
    expect(loadAppState(null, defaults)).toEqual(defaults);
  });

  it("reset sonrası okuma null döner ve varsayılanlar geri gelir", () => {
    const storage = memoryStorage();
    const defaults = sampleState();
    expect(writePersistedState(storage, sampleState())).toBe(true);
    expect(readPersistedState(storage)).not.toBeNull();

    clearPersistedState(storage);
    expect(readPersistedState(storage)).toBeNull();
    expect(loadAppState(storage, defaults)).toEqual(defaults);
  });

  it("kota hatasında yazım false döner, uygulama düşmez", () => {
    const storage: StorageLike = {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota");
      },
      removeItem: () => {
        throw new Error("yoksay");
      },
    };
    expect(writePersistedState(storage, sampleState())).toBe(false);
    expect(() => clearPersistedState(storage)).not.toThrow();
  });
});

describe("restored ordering, pinned ve planned sırası", () => {
  it("roundtrip sonrası grid sırası birebir aynı kalır", () => {
    const state = sampleState();
    const before = computeGrid(state.existingPosts, state.plannedPosts);

    const restored = deserializeAppState(serializeAppState(state));
    expect(restored).not.toBeNull();
    const after = computeGrid(
      restored?.existingPosts ?? [],
      restored?.plannedPosts ?? [],
    );

    expect(after.cells.map((cell) => cell.post.id)).toEqual(
      before.cells.map((cell) => cell.post.id),
    );
    expect(after.pinnedCount).toBe(before.pinnedCount);
  });

  it("pinned state ve pinnedOrder geri yüklenir", () => {
    const restored = deserializeAppState(serializeAppState(sampleState()));
    const pinned = (restored?.existingPosts ?? []).filter((p) => p.pinned);
    expect(pinned.map((p) => [p.id, p.pinnedOrder])).toEqual([
      ["e-new", 1],
      ["e-pin", 0],
    ]);
  });

  it("planlanan sırası (planOrder + dizi) geri yüklenir", () => {
    const restored = deserializeAppState(serializeAppState(sampleState()));
    expect(restored?.plannedPosts.map((p) => [p.id, p.planOrder])).toEqual([
      ["p-second", 1],
      ["p-first", 0],
    ]);
    const sorted = [...(restored?.plannedPosts ?? [])].sort(
      (a, b) => a.planOrder - b.planOrder,
    );
    expect(sorted.map((p) => p.id)).toEqual(["p-first", "p-second"]);
  });

  it("recency sırası geri yüklenir", () => {
    const restored = deserializeAppState(serializeAppState(sampleState()));
    const sorted = [...(restored?.existingPosts ?? [])].sort(
      (a, b) => a.recencyIndex - b.recencyIndex,
    );
    expect(sorted.map((p) => p.id)).toEqual(["e-new", "e-pin", "e-old"]);
  });
});

describe("toPersistableState (blob: localStorage'a girmez)", () => {
  it("idb referansını haritadan aynen korur, http URL'yi olduğu gibi yazar", () => {
    const ref = makeImageRef("abc");
    const state = sampleState();
    state.existingPosts[0].imageUrl = ref;
    const out = toPersistableState(state, new Map());
    expect(out.existingPosts[0].imageUrl).toBe(ref);
    expect(out.existingPosts[1].imageUrl).toBe("https://example.com/e1.jpg");
    expect(out.brand.profileImageUrl).toBe("https://example.com/avatar.png");
  });

  it("haritadaki blob: URL'ini idb referansına çevirir", () => {
    const objectUrl = "blob:http://localhost/1234";
    const ref = makeImageRef("uploaded-1");
    const state = sampleState();
    state.brand.profileImageUrl = objectUrl;
    state.plannedPosts[0].imageUrl = objectUrl;

    const out = toPersistableState(state, new Map([[objectUrl, ref]]));
    expect(out.brand.profileImageUrl).toBe(ref);
    expect(out.plannedPosts[0].imageUrl).toBe(ref);
    // state içinde object URL kaldı (görüntüleme için), yazılmadı.
    expect(state.brand.profileImageUrl).toBe(objectUrl);
  });

  it("haritasız blob: URL'leri yazılmaz (profil düşer, gönderi çıkar)", () => {
    const state = sampleState();
    state.brand.profileImageUrl = "blob:http://localhost/profil";
    state.existingPosts[1].imageUrl = "blob:http://localhost/kayip";
    state.plannedPosts[1].imageUrl = "blob:http://localhost/kayip2";

    const out = toPersistableState(state, new Map());
    expect(out.brand.profileImageUrl).toBeUndefined();
    expect(out.existingPosts.map((p) => p.id)).toEqual(["e-new", "e-old"]);
    expect(out.plannedPosts.map((p) => p.id)).toEqual(["p-second"]);
    expect(JSON.stringify(out)).not.toContain("blob:");
  });
});

describe("image ref yardımcıları", () => {
  it("makeImageRef / isImageRef / imageRefId", () => {
    const ref = makeImageRef("kimlik-1");
    expect(ref).toBe("idb:kimlik-1");
    expect(isImageRef(ref)).toBe(true);
    expect(imageRefId(ref)).toBe("kimlik-1");

    expect(isImageRef("https://example.com/x.png")).toBe(false);
    expect(imageRefId("https://example.com/x.png")).toBeNull();
    expect(imageRefId("idb:")).toBeNull();
  });
});
