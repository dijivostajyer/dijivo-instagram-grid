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

describe("v1 proje migration", () => {
  it("tek-grid v1 kaydını aktif projeye taşır ve eski post türünü post kabul eder", () => {
    const old = { ...sampleState(), version: 1 };
    const restored = deserializeAppState(JSON.stringify(old));
    expect(restored?.version).toBe(STORAGE_VERSION);
    expect(restored?.projects).toHaveLength(1);
    expect(restored?.activeProjectId).toBe(restored?.projects?.[0].id);
    expect(restored?.projects?.[0].existingPosts[0].postType).toBe("post");
  });
});

describe("project validation", () => {
  it("invalid month, duplicate ids ve bulunmayan aktif proje için güvenli fallback döner", () => {
    const base = sampleState();
    const project = { id: "project-1", name: "Eylül", month: 9, year: 2026, createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z", brand: BRAND, existingPosts: [], plannedPosts: [] };
    for (const invalid of [
      { ...project, month: 13 },
      { ...project, year: 1900 },
    ]) {
      expect(deserializeAppState(JSON.stringify({ ...base, projects: [invalid], activeProjectId: invalid.id }))).toBeNull();
    }
    expect(deserializeAppState(JSON.stringify({ ...base, projects: [project, { ...project }], activeProjectId: project.id }))).toBeNull();
    expect(deserializeAppState(JSON.stringify({ ...base, projects: [project], activeProjectId: "missing" }))).toBeNull();
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

describe("v2 → v3 çok-marka migration", () => {
  it("v2 tek-marka kaydını brands[] altında toplar ve projelere brandId ekler", () => {
    const project = { id: "project-1", name: "Ekim 2026", month: 10, year: 2026, createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z", brand: BRAND, existingPosts: [], plannedPosts: [] };
    const v2 = { version: 2, brand: BRAND, existingPosts: [], plannedPosts: [], projects: [project], activeProjectId: project.id };
    const restored = deserializeAppState(JSON.stringify(v2));
    expect(restored?.version).toBe(STORAGE_VERSION);
    expect(restored?.brands).toEqual([BRAND]);
    expect(restored?.activeBrandId).toBe(BRAND.id);
    expect(restored?.projects?.[0].brandId).toBe(BRAND.id);
    // Üst düzey veri ve projeler korunur.
    expect(restored?.projects?.[0].id).toBe(project.id);
  });

  it("v2 kayıtta farklı markalı projeler tekilleştirilerek kayıt defterine düşer", () => {
    const brandB: Brand = { id: "marka-2", name: "Marka 2", username: "marka2" };
    const projectA = { id: "pa", name: "A", month: 9, year: 2026, createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z", brand: BRAND, existingPosts: [], plannedPosts: [] };
    const projectB = { id: "pb", name: "B", month: 10, year: 2026, createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z", brand: brandB, existingPosts: [], plannedPosts: [] };
    const v2 = { version: 2, brand: BRAND, existingPosts: [], plannedPosts: [], projects: [projectA, projectB], activeProjectId: "pb" };
    const restored = deserializeAppState(JSON.stringify(v2));
    expect(restored?.brands).toHaveLength(2);
    expect(restored?.brands?.[0].id).toBe(BRAND.id);
    expect(restored?.brands?.[1].id).toBe("marka-2");
    expect(restored?.activeBrandId).toBe(BRAND.id);
    expect(restored?.projects?.[0].brandId).toBe(BRAND.id);
    expect(restored?.projects?.[1].brandId).toBe("marka-2");
  });

  it("v1 kaydı da brands[] altında toplanır", () => {
    const old = { ...sampleState(), version: 1 };
    const restored = deserializeAppState(JSON.stringify(old));
    expect(restored?.brands).toEqual([BRAND]);
    expect(restored?.activeBrandId).toBe(BRAND.id);
    expect(restored?.projects?.[0].brandId).toBe(BRAND.id);
  });
});

describe("v3 çok-marka doğrulama", () => {
  it("brands ve activeBrandId roundtrip'te korunur", () => {
    const brandB: Brand = { id: "marka-2", name: "Marka 2", username: "marka2" };
    const state: PersistedAppState = {
      version: STORAGE_VERSION,
      brand: BRAND,
      existingPosts: [],
      plannedPosts: [],
      brands: [BRAND, brandB],
      activeBrandId: "marka-2",
      projects: [],
      activeProjectId: "",
    };
    expect(deserializeAppState(serializeAppState(state))).toEqual(state);
  });

  it("boş brands listesi (fresh/onboarding state) geçerlidir", () => {
    const state: PersistedAppState = { ...sampleState(), brands: [], activeBrandId: "" };
    const restored = deserializeAppState(serializeAppState(state));
    expect(restored?.brands).toEqual([]);
    expect(restored?.activeBrandId).toBe("");
  });

  it("boş brands listesinde dolu activeBrandId null döner", () => {
    const json = JSON.stringify({ version: STORAGE_VERSION, brand: BRAND, existingPosts: [], plannedPosts: [], brands: [], activeBrandId: "marka-1" });
    expect(deserializeAppState(json)).toBeNull();
  });

  it("tekrarlayan marka kimlikleri null döner", () => {
    const json = JSON.stringify({ version: STORAGE_VERSION, brand: BRAND, existingPosts: [], plannedPosts: [], brands: [BRAND, { ...BRAND }], activeBrandId: BRAND.id });
    expect(deserializeAppState(json)).toBeNull();
  });

  it("activeBrandId marka listesinde yoksa null döner", () => {
    const json = JSON.stringify({ version: STORAGE_VERSION, brand: BRAND, existingPosts: [], plannedPosts: [], brands: [BRAND], activeBrandId: "eksik" });
    expect(deserializeAppState(json)).toBeNull();
  });

  it("geçersiz marka kaydı null döner", () => {
    const json = JSON.stringify({ version: STORAGE_VERSION, brand: BRAND, existingPosts: [], plannedPosts: [], brands: [{ ...BRAND, id: 1 }], activeBrandId: BRAND.id });
    expect(deserializeAppState(json)).toBeNull();
  });
});

describe("caption ve hashtag kalıcılığı", () => {
  it("post caption, hashtag grupları, mention/CTA ve yeni marka alanları roundtrip'te korunur", () => {
    const state = sampleState();
    state.existingPosts[0].caption = "Caption #dijivo @dijivo";
    state.plannedPosts[0].caption = "Planlanan açıklama";
    const brand: Brand = {
      ...BRAND,
      displayName: "Görünen Ad",
      website: "https://dijivo.com",
      phone: "+90 555",
      email: "merhaba@dijivo.com",
      category: "Ajans",
      hashtagGroups: [{ id: "hg-1", title: "Genel", tags: ["dijivo", "socialmedia"] }],
      defaultMentions: ["@dijivo"],
      defaultCtas: ["Detaylı bilgi için DM üzerinden bizimle iletişime geçin."],
    };
    state.brand = brand;
    const restored = deserializeAppState(serializeAppState(state));
    expect(restored?.existingPosts[0].caption).toBe("Caption #dijivo @dijivo");
    expect(restored?.plannedPosts[0].caption).toBe("Planlanan açıklama");
    expect(restored?.brand.displayName).toBe("Görünen Ad");
    expect(restored?.brand.website).toBe("https://dijivo.com");
    expect(restored?.brand.phone).toBe("+90 555");
    expect(restored?.brand.email).toBe("merhaba@dijivo.com");
    expect(restored?.brand.category).toBe("Ajans");
    expect(restored?.brand.hashtagGroups).toEqual(brand.hashtagGroups);
    expect(restored?.brand.defaultMentions).toEqual(["@dijivo"]);
    expect(restored?.brand.defaultCtas).toHaveLength(1);
  });

  it("geçersiz hashtag grubu null döner", () => {
    const json = JSON.stringify({
      version: STORAGE_VERSION,
      brand: { ...BRAND, hashtagGroups: [{ id: "hg", title: "Genel", tags: ["ok", 42] }] },
      existingPosts: [],
      plannedPosts: [],
    });
    expect(deserializeAppState(json)).toBeNull();
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
