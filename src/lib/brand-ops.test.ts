import { describe, expect, it } from "vitest";

import {
  copyHighlightToBrandState,
  copyPostToProjectState,
  createBrandState,
  createProjectState,
  getDefaultAppState,
  selectBrandState,
  selectProjectState,
  syncActiveProject,
  type NewBrandInput,
  type PostCopyOptions,
} from "./brand-ops";
import {
  deserializeAppState,
  serializeAppState,
  type PersistedAppState,
} from "./storage";
import type { ExistingPost, PlannedPost } from "./types";

const NOW = new Date("2026-10-01T12:00:00.000Z");

const ALL_OPTIONS: PostCopyOptions = {
  caption: true,
  postType: true,
  hashtags: true,
  pinned: false,
};

function brandInput(name: string, username: string): NewBrandInput {
  return {
    name,
    username,
    bio: `${name} bio`,
    followersCount: 1234,
    followingCount: 567,
  };
}

function existingPost(id: string, caption?: string): ExistingPost {
  return {
    id,
    source: "mevcut",
    imageUrl: `https://cdn.example.com/${id}.jpg`,
    alt: id,
    postType: "post",
    aspectRatio: "1:1",
    caption,
    recencyIndex: 0,
    pinned: false,
  };
}

function plannedPost(id: string, caption?: string): PlannedPost {
  return {
    id,
    source: "planlanan",
    imageUrl: `https://cdn.example.com/${id}.jpg`,
    postType: "reel",
    caption,
    planOrder: 0,
  };
}

/**
 * Projeye mevcut gönderi ekler; hedef aktif proje ise üst düzey
 * aynayı da günceller (hook'taki setExistingPosts'e eşdeğer).
 */
function withExistingPost(
  state: PersistedAppState,
  projectId: string,
  post: ExistingPost,
): PersistedAppState {
  const projects = (state.projects ?? []).map((project) =>
    project.id === projectId
      ? {
          ...project,
          existingPosts: [post, ...project.existingPosts],
          updatedAt: new Date().toISOString(),
        }
      : project,
  );
  const isActive = state.activeProjectId === projectId;
  return syncActiveProject({
    ...state,
    projects,
    ...(isActive ? { existingPosts: [post, ...state.existingPosts] } : {}),
  });
}

function projectFor(state: PersistedAppState, projectId: string) {
  const project = (state.projects ?? []).find((item) => item.id === projectId);
  if (!project) throw new Error(`proje bulunamadı: ${projectId}`);
  return project;
}

describe("onboarding / varsayılan durum (§2/§22)", () => {
  it("getDefaultAppState: henüz marka yok → onboarding ekranı", () => {
    const state = getDefaultAppState();
    expect(state.brands).toEqual([]);
    expect(state.activeBrandId).toBe("");
    expect(state.projects).toEqual([]);
    expect(state.activeProjectId).toBe("");
  });
});

describe("marka oluşturma (§2/§3)", () => {
  it("geçerli girdi: kayıt defterine ekler, aktif yapar, boş aylık plan açar", () => {
    const result = createBrandState(
      getDefaultAppState(),
      brandInput("Dijivo", "dijivo"),
      NOW,
    );
    expect(result).not.toBeNull();
    const { state, brand } = result!;
    expect(brand.name).toBe("Dijivo");
    expect(brand.username).toBe("dijivo");
    expect(brand.hashtagGroups).toEqual([]);
    expect(brand.defaultMentions).toEqual([]);
    expect(brand.defaultCtas).toEqual([]);
    expect(state.brands).toHaveLength(1);
    expect(state.activeBrandId).toBe(brand.id);
    expect(state.activeProjectId).not.toBe("");
    const project = projectFor(state, state.activeProjectId!);
    expect(project.brandId).toBe(brand.id);
    expect(project.name).toBe("Ekim 2026");
    expect(project.existingPosts).toEqual([]);
    // Üst düzey ayna yeni markayı gösterir.
    expect(state.brand.id).toBe(brand.id);
  });

  it("geçersiz girdi (boş marka adı / kullanıcı adı) → null", () => {
    const base = brandInput("Dijivo", "dijivo");
    expect(
      createBrandState(getDefaultAppState(), { ...base, name: "   " }, NOW),
    ).toBeNull();
    expect(
      createBrandState(getDefaultAppState(), { ...base, username: "" }, NOW),
    ).toBeNull();
  });
});

describe("marka değiştirme ve izolasyon (§5/§20)", () => {
  function twoBrandState() {
    const first = createBrandState(
      getDefaultAppState(),
      brandInput("Marka A", "markaa"),
      NOW,
    )!;
    const second = createBrandState(
      first.state,
      brandInput("Marka B", "markab"),
      NOW,
    )!;
    // İki marka da aynı ay için ayrı projeye sahip olur.
    expect(second.state.projects).toHaveLength(2);
    expect(new Set(second.state.projects!.map((p) => p.name)).size).toBe(1);
    return { state: second.state, brandA: first.brand, brandB: second.brand };
  }

  it("marka değişimi: hedef markanın en son projesi aktif olur", () => {
    const { state, brandA } = twoBrandState();
    const switched = selectBrandState(state, brandA.id)!;
    expect(switched.activeBrandId).toBe(brandA.id);
    expect(switched.brand.id).toBe(brandA.id);
    expect(switched.brand.name).toBe("Marka A");
    expect(switched.activeProjectId).not.toBe("");
  });

  it("aynı ay ismindeki projeler karışmaz (§20)", () => {
    const { state, brandA, brandB } = twoBrandState();
    const projectB = state.projects!.find((p) => p.brandId === brandB.id)!;
    const withPost = withExistingPost(
      state,
      projectB.id,
      existingPost("post-b", "Sadece B'de"),
    );
    // Marka A görünümünde A'nın içeriği boş kalmalı.
    const viewA = selectBrandState(withPost, brandA.id)!;
    expect(viewA.existingPosts).toEqual([]);
    // Marka B görünümünde B'nin gönderisi görünmeli.
    const viewB = selectBrandState(withPost, brandB.id)!;
    expect(viewB.existingPosts.map((p) => p.id)).toEqual(["post-b"]);
  });

  it("projesi olmayan marka seçiminde boş plan durumu döner", () => {
    const { state, brandB } = twoBrandState();
    const stripped = {
      ...state,
      projects: state.projects!.filter((p) => p.brandId !== brandB.id),
    };
    const viewB = selectBrandState(stripped, brandB.id)!;
    expect(viewB.activeProjectId).toBe("");
    expect(viewB.existingPosts).toEqual([]);
  });

  it("aktif olmayan markanın projesi seçilemez (§5)", () => {
    const { state, brandA, brandB } = twoBrandState();
    const projectB = state.projects!.find((p) => p.brandId === brandB.id)!;
    const viewA = selectBrandState(state, brandA.id)!;
    expect(selectProjectState(viewA, projectB.id)).toBeNull();
  });

  it("kendi markasının projesi seçilebilir", () => {
    const { state, brandA } = twoBrandState();
    const viewA = selectBrandState(state, brandA.id)!;
    const projectA = viewA.projects!.find((p) => p.brandId === brandA.id)!;
    const next = selectProjectState(viewA, projectA.id)!;
    expect(next.activeProjectId).toBe(projectA.id);
    expect(next.activeBrandId).toBe(brandA.id);
  });

  it("syncActiveProject: üst düzey ayna aktif projeye yazılır", () => {
    const first = createBrandState(
      getDefaultAppState(),
      brandInput("Marka A", "markaa"),
      NOW,
    )!;
    const project = first.state.projects![0];
    const next = syncActiveProject({
      ...first.state,
      existingPosts: [existingPost("post-1")],
    });
    expect(projectFor(next, project.id).existingPosts).toHaveLength(1);
  });
});

describe("aylık plan oluşturma (§4/§19)", () => {
  it("önceki ayı kopyala: aynı marka içinde gönderiler yeni kimlikle kopyalanır", () => {
    const september = new Date("2026-09-05T10:00:00.000Z");
    const first = createBrandState(
      getDefaultAppState(),
      brandInput("Marka A", "markaa"),
      september,
    )!;
    const projectA = first.state.projects![0];
    const withPost = withExistingPost(
      first.state,
      projectA.id,
      existingPost("post-1", "Eylül içeriği"),
    );
    const result = createProjectState(withPost, "Ekim 2026", 10, 2026, true);
    if ("error" in result) throw new Error("beklenmeyen hata");
    const october = projectFor(result.state, result.projectId);
    expect(october.month).toBe(10);
    expect(october.existingPosts).toHaveLength(1);
    expect(october.existingPosts[0].id).not.toBe("post-1");
    expect(october.existingPosts[0].caption).toBe("Eylül içeriği");
    // Kaynak proje değişmez.
    expect(projectFor(withPost, projectA.id).existingPosts[0].id).toBe("post-1");
  });

  it("önceki ay yoksa hata döner", () => {
    const first = createBrandState(
      getDefaultAppState(),
      brandInput("Marka A", "markaa"),
      NOW,
    )!;
    expect(
      createProjectState(first.state, "Aralık 2026", 12, 2026, true),
    ).toEqual({ error: "Önceki aya ait kopyalanacak proje bulunamadı." });
  });

  it("başka markanın önceki ayı asla kaynak olarak seçilmez (§19)", () => {
    const a = createBrandState(
      getDefaultAppState(),
      brandInput("Marka A", "markaa"),
      new Date("2026-09-05T10:00:00.000Z"),
    )!;
    const b = createBrandState(
      a.state,
      brandInput("Marka B", "markab"),
      new Date("2026-09-06T10:00:00.000Z"),
    )!;
    const projectA = a.state.projects![0];
    const projectB = b.state.projects!.find((p) => p.brandId === b.brand.id)!;
    let state = withExistingPost(
      b.state,
      projectA.id,
      existingPost("post-a", "A Eylül"),
    );
    state = withExistingPost(
      state,
      projectB.id,
      existingPost("post-b", "B Eylül"),
    );
    // B aktifken Ekim 2026 oluştur → yalnızca B'nin Eylül projesi kaynak olmalı.
    const viewB = selectBrandState(state, b.brand.id)!;
    const result = createProjectState(viewB, "Ekim 2026", 10, 2026, true);
    if ("error" in result) throw new Error("beklenmeyen hata");
    const october = projectFor(result.state, result.projectId);
    expect(october.brandId).toBe(b.brand.id);
    expect(october.existingPosts).toHaveLength(1);
    expect(october.existingPosts[0].caption).toBe("B Eylül");
  });
});

describe("gönderi kopyalama (§16/§21)", () => {
  function crossBrandState() {
    const a = createBrandState(
      getDefaultAppState(),
      brandInput("Marka A", "markaa"),
      NOW,
    )!;
    const b = createBrandState(a.state, brandInput("Marka B", "markab"), NOW)!;
    const projectA = a.state.projects![0];
    const projectB = b.state.projects!.find((p) => p.brandId === b.brand.id)!;
    return { state: b.state, brandA: a.brand, brandB: b.brand, projectA, projectB };
  }

  it("çapraz marka kopya: yeni kimlik, caption + hedef hashtagleri, kaynak değişmez", () => {
    const { state, brandB, projectA, projectB } = crossBrandState();
    let next = withExistingPost(
      state,
      projectA.id,
      existingPost("post-a", "Merhaba dünya"),
    );
    // Hedef markanın hashtag grupları (kayıt defterinde).
    const brandBWithTags = {
      ...brandB,
      hashtagGroups: [{ id: "hg-1", title: "Genel", tags: ["#dijivo", "#grid"] }],
    };
    next = {
      ...next,
      brands: next.brands!.map((brand) =>
        brand.id === brandB.id ? brandBWithTags : brand,
      ),
    };
    const result = copyPostToProjectState(
      next,
      "post-a",
      projectB.id,
      ALL_OPTIONS,
    );
    if ("error" in result) throw new Error("beklenmeyen hata");
    const target = projectFor(result.state, projectB.id);
    expect(target.existingPosts).toHaveLength(1);
    const copy = target.existingPosts[0];
    expect(copy.id).not.toBe("post-a");
    expect(copy.caption).toBe("Merhaba dünya\n\n#dijivo #grid");
    expect(copy.postType).toBe("post");
    // Kaynak proje değişmez.
    const source = projectFor(result.state, projectA.id);
    expect(source.existingPosts).toHaveLength(1);
    expect(source.existingPosts[0].id).toBe("post-a");
    expect(source.existingPosts[0].caption).toBe("Merhaba dünya");
  });

  it("seçenekler kapalıyken caption/tür aktarılmaz", () => {
    const { state, projectA, projectB } = crossBrandState();
    const next = withExistingPost(
      state,
      projectA.id,
      existingPost("post-a", "Sadece caption"),
    );
    const result = copyPostToProjectState(next, "post-a", projectB.id, {
      caption: false,
      postType: false,
      hashtags: false,
      pinned: false,
    });
    if ("error" in result) throw new Error("beklenmeyen hata");
    const copy = projectFor(result.state, projectB.id).existingPosts[0];
    expect(copy.caption).toBeUndefined();
    expect(copy.imageUrl).toBe("https://cdn.example.com/post-a.jpg");
  });

  it("planlanan gönderi kopyası hedefin planlanan listesine düşer", () => {
    const { state, brandB, projectA, projectB } = crossBrandState();
    const next = {
      ...state,
      projects: state.projects!.map((project) =>
        project.id === projectA.id
          ? { ...project, plannedPosts: [plannedPost("plan-1", "Plan içeriği")] }
          : project,
      ),
    };
    const result = copyPostToProjectState(next, "plan-1", projectB.id, {
      caption: true,
      postType: true,
      hashtags: false,
      pinned: false,
    });
    if ("error" in result) throw new Error("beklenmeyen hata");
    const target = projectFor(result.state, projectB.id);
    expect(target.plannedPosts).toHaveLength(1);
    expect(target.plannedPosts[0].caption).toBe("Plan içeriği");
    expect(target.plannedPosts[0].source).toBe("planlanan");
    expect(target.plannedPosts[0].planOrder).toBe(0);
    // Hedef markanın hashtag grubu planned caption'a da eklenir.
    const brandBWithTags = {
      ...brandB,
      hashtagGroups: [{ id: "hg-1", title: "Genel", tags: ["#reklam"] }],
    };
    const withTags = {
      ...next,
      brands: next.brands!.map((brand) =>
        brand.id === brandB.id ? brandBWithTags : brand,
      ),
    };
    const tagged = copyPostToProjectState(withTags, "plan-1", projectB.id, {
      caption: true,
      postType: false,
      hashtags: true,
      pinned: false,
    });
    if ("error" in tagged) throw new Error("beklenmeyen hata");
    const taggedCopy = projectFor(tagged.state, projectB.id).plannedPosts[0];
    expect(taggedCopy.caption).toBe("Plan içeriği\n\n#reklam");
  });

  it("pin seçeneği: pinned gönderi hedefe sabitlenir (limit içinde)", () => {
    const { state, projectA, projectB } = crossBrandState();
    const pinned = { ...existingPost("post-pin", "Sabit"), pinned: true, pinnedOrder: 0 };
    const next = withExistingPost(state, projectA.id, pinned);
    const result = copyPostToProjectState(next, "post-pin", projectB.id, {
      ...ALL_OPTIONS,
      pinned: true,
    });
    if ("error" in result) throw new Error("beklenmeyen hata");
    const copy = projectFor(result.state, projectB.id).existingPosts[0];
    expect(copy.pinned).toBe(true);
  });

  it("aktif projeye kopya: yeni gönderi aktif aynada görünür", () => {
    const first = createBrandState(
      getDefaultAppState(),
      brandInput("Marka A", "markaa"),
      NOW,
    )!;
    const created = createProjectState(first.state, "Kasım 2026", 11, 2026, false);
    if ("error" in created) throw new Error("beklenmeyen hata");
    let state = created.state;
    const november = projectFor(state, created.projectId);
    state = withExistingPost(state, november.id, existingPost("post-x", "Kasım içeriği"));
    const october = projectFor(state, first.state.projects![0].id);
    // Ekim projesi (aktif) hedef; Kasım'daki gönderi kopyalanıyor.
    const viewOctober = selectProjectState(state, october.id)!;
    const result = copyPostToProjectState(viewOctober, "post-x", october.id, ALL_OPTIONS);
    if ("error" in result) throw new Error("beklenmeyen hata");
    expect(result.state.existingPosts).toHaveLength(1);
    expect(result.state.existingPosts[0].caption).toBe("Kasım içeriği");
    expect(projectFor(result.state, october.id).existingPosts).toHaveLength(1);
  });

  it("hata durumları: bilinmeyen gönderi / hedef / aynı proje", () => {
    const first = createBrandState(
      getDefaultAppState(),
      brandInput("Marka A", "markaa"),
      NOW,
    )!;
    const projectA = first.state.projects![0];
    const state = withExistingPost(first.state, projectA.id, existingPost("post-a"));
    expect(
      copyPostToProjectState(state, "yok", projectA.id, ALL_OPTIONS),
    ).toEqual({ error: "Kaynak gönderi bulunamadı." });
    expect(
      copyPostToProjectState(state, "post-a", "hedef-yok", ALL_OPTIONS),
    ).toEqual({ error: "Hedef proje bulunamadı." });
    expect(
      copyPostToProjectState(state, "post-a", projectA.id, ALL_OPTIONS),
    ).toEqual({ error: "Gönderi zaten bu projede." });
  });
});

describe("öne çıkanı başka markaya kopyalama (§17)", () => {
  const HIGHLIGHT = {
    id: "hl-a",
    title: "Kampanya",
    imageUrl: "https://cdn.example.com/hl.jpg",
  };

  function stateWithHighlight() {
    const a = createBrandState(
      getDefaultAppState(),
      brandInput("Marka A", "markaa"),
      NOW,
    )!;
    const withHighlight: PersistedAppState = {
      ...a.state,
      brands: a.state.brands!.map((brand) =>
        brand.id === a.brand.id
          ? { ...brand, highlights: [HIGHLIGHT] }
          : brand,
      ),
      projects: a.state.projects!.map((project) =>
        project.id === a.state.activeProjectId
          ? { ...project, brand: { ...project.brand, highlights: [HIGHLIGHT] } }
          : project,
      ),
    };
    const b = createBrandState(withHighlight, brandInput("Marka B", "markab"), NOW)!;
    return { state: b.state, brandA: a.brand, brandB: b.brand };
  }

  it("yeni kimlik + paylaşımlı görsel URL'i; kaynak değişmez, hedef aynalar güncellenir", () => {
    const { state, brandA, brandB } = stateWithHighlight();
    const result = copyHighlightToBrandState(state, "hl-a", brandB.id);
    if ("error" in result) throw new Error("beklenmeyen hata");
    const brandBAfter = result.state.brands!.find((b) => b.id === brandB.id)!;
    expect(brandBAfter.highlights).toHaveLength(1);
    expect(brandBAfter.highlights![0].id).not.toBe("hl-a");
    expect(brandBAfter.highlights![0].title).toBe("Kampanya");
    expect(brandBAfter.highlights![0].imageUrl).toBe(HIGHLIGHT.imageUrl);
    // Kaynak marka değişmez.
    const brandAAfter = result.state.brands!.find((b) => b.id === brandA.id)!;
    expect(brandAAfter.highlights![0].id).toBe("hl-a");
    // Hedef markanın proje aynaları da güncellenir.
    const projectB = result.state.projects!.find((p) => p.brandId === brandB.id)!;
    expect(projectB.brand.highlights).toHaveLength(1);
    expect(projectB.brand.highlights![0].imageUrl).toBe(HIGHLIGHT.imageUrl);
  });

  it("bilinmeyen öne çıkanı / hedef marka → hata", () => {
    const { state, brandB } = stateWithHighlight();
    expect(
      copyHighlightToBrandState(state, "yok", brandB.id),
    ).toEqual({ error: "Öne çıkan bulunamadı." });
    expect(
      copyHighlightToBrandState(state, "hl-a", "hedef-yok"),
    ).toEqual({ error: "Hedef marka bulunamadı." });
  });
});

describe("kalıcılık turu — F5 (§21)", () => {
  it("çoklu marka durum serialize→deserialize ile korunur", () => {
    const first = createBrandState(
      getDefaultAppState(),
      brandInput("Marka A", "markaa"),
      NOW,
    )!;
    const second = createBrandState(
      first.state,
      brandInput("Marka B", "markab"),
      NOW,
    )!;
    const projectA = second.state.projects!.find(
      (p) => p.brandId === first.brand.id,
    )!;
    const state = withExistingPost(
      second.state,
      projectA.id,
      existingPost("post-a", "Caption #test"),
    );
    const restored = deserializeAppState(serializeAppState(state));
    expect(restored).not.toBeNull();
    expect(restored!.brands).toHaveLength(2);
    expect(restored!.activeBrandId).toBe(second.brand.id);
    expect(restored!.projects).toHaveLength(2);
    const restoredA = restored!.projects!.find((p) => p.id === projectA.id)!;
    expect(restoredA.existingPosts).toHaveLength(1);
    expect(restoredA.existingPosts[0].caption).toBe("Caption #test");
    expect(restoredA.existingPosts[0].imageUrl).toBe(
      "https://cdn.example.com/post-a.jpg",
    );
  });
});
