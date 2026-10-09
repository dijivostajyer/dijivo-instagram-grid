import { describe, expect, it, vi } from "vitest";

import { BrightDataInstagramProvider } from "./brightdata";

const API_KEY = "test-secret-must-never-leak";
const DATASET_ID = "gd_profile_test";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function provider(responses: Array<Response | Error>, options: Partial<ConstructorParameters<typeof BrightDataInstagramProvider>[0]> = {}) {
  const fetchImpl = vi.fn(async () => {
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return next ?? json({}, 500);
  }) as unknown as typeof fetch;
  return {
    instance: new BrightDataInstagramProvider({
      apiKey: API_KEY,
      datasetId: DATASET_ID,
      fetchImpl,
      pollDelayMs: 0,
      wait: async () => undefined,
      ...options,
    }),
    fetchImpl,
  };
}

const RECORD = {
  account: "dijivo",
  full_name: "Dijivo Studio",
  biography: "Üretim stüdyosu",
  profile_image_link: "https://cdn.example.test/profile.jpg",
  followers: "1.2K",
  following: 24,
  posts_count: 3,
  is_verified: true,
  posts: [
    { id: "image-1", content_type: "Image", thumbnail_url: "https://cdn.example.test/image.jpg", caption: "Merhaba", datetime: "2026-10-01" },
    { id: "reel-1", content_type: "Reel", thumbnail_url: "https://cdn.example.test/reel.jpg", media_url: "https://cdn.example.test/reel.mp4" },
    { id: "carousel-1", content_type: "Carousel", thumbnail_url: "https://cdn.example.test/carousel.jpg" },
  ],
  highlights: [{ id: "h1", title: "Kampanya", highlight_url: "https://instagram.com/stories/highlights/h1", cover_url: "https://cdn.example.test/cover.jpg" }],
};

describe("Bright Data Instagram provider", () => {
  it("doğrudan records yanıtını normalize eder", async () => {
    const { instance, fetchImpl } = provider([json([RECORD])]);
    const result = await instance.fetchProfile("dijivo");

    expect(result.profile).toMatchObject({ username: "dijivo", displayName: "Dijivo Studio", followersCount: 1200, followingCount: 24, postsCount: 3, isVerified: true });
    expect(result.profile?.recentPosts).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "image-1", type: "post" }),
      expect.objectContaining({ id: "reel-1", type: "reel", mediaUrl: "https://cdn.example.test/reel.mp4" }),
      expect.objectContaining({ id: "carousel-1", type: "carousel" }),
    ]));
    expect(result.profile?.highlights).toEqual([expect.objectContaining({ id: "h1", title: "Kampanya" })]);
    expect(fetchImpl).toHaveBeenCalledWith(expect.stringContaining("/scrape?"), expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ Authorization: `Bearer ${API_KEY}` }),
    }));
  });

  it("kısmi profile izin verir ve geçersiz medya alanlarını atlar", async () => {
    const { instance } = provider([json([{ account: "kismi", posts: [{ id: "broken", content_type: "Something" }] }])]);
    const result = await instance.fetchProfile("kismi");
    expect(result.profile).toMatchObject({ username: "kismi" });
    expect(result.profile?.recentPosts).toEqual([]);
  });

  it("gizli hesapta profil ile Türkçe uyarıyı birlikte döndürür", async () => {
    const { instance } = provider([json([{ account: "gizli", is_private: true }])]);
    const result = await instance.fetchProfile("gizli");
    expect(result.profile?.isPrivate).toBe(true);
    expect(result.warnings).toContain("Bu hesap gizli olduğu için gönderiler veya öne çıkanlar alınamayabilir.");
  });

  it.each([
    [401, "yetkilendirmesi başarısız"],
    [429, "istek sınırına"],
    [500, "şu anda alınamıyor"],
  ])("HTTP %i yanıtını güvenli Türkçe hataya dönüştürür", async (status, expected) => {
    const { instance } = provider([json({ error: "provider raw error" }, status)]);
    await expect(instance.fetchProfile("dijivo")).rejects.toMatchObject({ userMessage: expect.stringContaining(expected) });
  });

  it("timeout'ta anahtar veya raw hata sızdırmaz", async () => {
    const { instance } = provider([Object.assign(new Error("AbortError"), { name: "AbortError" })]);
    await expect(instance.fetchProfile("dijivo")).rejects.toMatchObject({ userMessage: "Instagram bilgileri şu anda alınamıyor. Lütfen tekrar deneyin." });
  });

  it("bozuk başarılı yanıtı profil bulunamadı olarak ele alır", async () => {
    const { instance } = provider([json({ unexpected: true })]);
    await expect(instance.fetchProfile("dijivo")).rejects.toMatchObject({ userMessage: "Instagram profili bulunamadı." });
  });

  it("202 snapshot yanıtını sınırlı polling ile indirir", async () => {
    const { instance, fetchImpl } = provider([
      json({ snapshot_id: "snap-1" }, 202),
      json({ status: "running" }),
      json({ status: "ready" }),
      json([RECORD]),
    ]);
    const result = await instance.fetchProfile("dijivo");
    expect(result.profile?.username).toBe("dijivo");
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it("async importta snapshot kimliğini yalnız provider sonucunda tutar ve hazır sonucu normalize eder", async () => {
    const { instance, fetchImpl } = provider([
      json({ snapshot_id: "snapshot-server-only" }, 200),
      json({ status: "ready" }),
      json([RECORD]),
    ]);
    const snapshot = await instance.startProfileImport("dijivo");
    const state = await instance.getProfileImport(snapshot, "dijivo");
    expect(snapshot).toBe("snapshot-server-only");
    expect(state).toMatchObject({ status: "ready", result: { profile: { username: "dijivo" } } });
    expect(fetchImpl).toHaveBeenNthCalledWith(1, expect.stringContaining("/trigger?"), expect.anything());
    expect(fetchImpl).toHaveBeenNthCalledWith(3, expect.stringContaining("/snapshot/snapshot-server-only?format=json"), expect.anything());
  });

  it("async import hazır değilse profil yerine yalnız preparing durumu döndürür", async () => {
    const { instance } = provider([json({ status: "running" })]);
    await expect(instance.getProfileImport("snapshot-server-only", "dijivo")).resolves.toEqual({ status: "preparing" });
  });

  it("hazır olmayan snapshot için deneme sınırında kontrollü hata verir", async () => {
    const { instance, fetchImpl } = provider([
      json({ snapshot_id: "snap-timeout" }, 202),
      json({ status: "running" }),
      json({ status: "running" }),
    ], { pollAttempts: 2 });
    await expect(instance.fetchProfile("dijivo")).rejects.toMatchObject({ userMessage: "Instagram bilgileri şu anda alınamıyor. Lütfen tekrar deneyin." });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("sonuç veya hata mesajı API anahtarını içermez", async () => {
    const { instance } = provider([json({ error: API_KEY }, 500)]);
    await expect(instance.fetchProfile("dijivo")).rejects.not.toThrow(API_KEY);
  });
});
