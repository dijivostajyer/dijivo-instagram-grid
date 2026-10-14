import { describe, expect, it } from "vitest";

import { InMemoryShareStore } from "./share-store";
import { SupabaseShareStore, type SnapshotRow, type SupabaseShareDriver } from "./supabase-share-store";
import { InMemoryShareFeedbackStore } from "./share-feedback-store";
import { handleFeedbackGet, handleFeedbackPost, type FeedbackApiDeps } from "./share-feedback-api";
import { createRateLimiter } from "./rate-limit";
import type { ShareSnapshotInput } from "./share";

const TOKEN = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-10-14T12:00:00.000Z");

const input: ShareSnapshotInput = {
  brand: { name: "Marka", username: "marka" },
  cells: [
    { id: "post-1", source: "mevcut", imageUrl: "https://cdn.test/p.jpg", position: 0, row: 0, column: 0, pinned: false, postType: "post" },
    { id: "reel-1", source: "planlanan", imageUrl: "https://cdn.test/r.jpg", position: 1, row: 0, column: 1, pinned: false, postType: "reel" },
    { id: "car-1", source: "mevcut", imageUrl: "https://cdn.test/c.jpg", position: 2, row: 0, column: 2, pinned: false, postType: "carousel" },
  ],
  stories: [{ id: "story-1", mediaType: "image", mediaUrl: "https://cdn.test/s.jpg", sortOrder: 0 }],
  context: { brandId: "brand-a", projectId: "project-oct" },
};

async function setup(overrides: Partial<FeedbackApiDeps> = {}, snapshotInput: ShareSnapshotInput = input) {
  const shareStore = new InMemoryShareStore(() => TOKEN, () => NOW);
  await shareStore.create(snapshotInput);
  const feedbackStore = new InMemoryShareFeedbackStore(() => NOW);
  const deps: FeedbackApiDeps = {
    shareStore,
    feedbackStore,
    rateLimiter: createRateLimiter({ max: 100, windowMs: 60_000 }),
    now: () => NOW,
    ...overrides,
  };
  return { deps, feedbackStore };
}

function request(body: unknown, ip = "203.0.113.5") {
  return new Request(`https://app.test/api/shares/${TOKEN}/feedback`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": ip },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const base = { clientName: "Ayşe Yılmaz" };

describe("POST /api/shares/[token]/feedback", () => {
  it("A. geçerli token + Post onayı kaydedilir; marka/plan snapshot'tan gelir", async () => {
    const { deps, feedbackStore } = await setup();
    const result = await handleFeedbackPost(request({ ...base, targetType: "post", targetId: "post-1", action: "approved" }), TOKEN, deps);
    expect(result.status).toBe(201);
    expect(result.body.feedback).toMatchObject({ targetType: "post", targetId: "post-1", action: "approved", message: null, clientName: "Ayşe Yılmaz" });
    expect((await feedbackStore.list(TOKEN))[0]).toMatchObject({ brandId: "brand-a", projectId: "project-oct", shareToken: TOKEN });
  });

  it("A. Carousel, Post hedefi olarak kabul edilir", async () => {
    const { deps } = await setup();
    expect((await handleFeedbackPost(request({ ...base, targetType: "post", targetId: "car-1", action: "approved" }), TOKEN, deps)).status).toBe(201);
  });

  it("B. Reel onayı", async () => {
    const { deps } = await setup();
    const result = await handleFeedbackPost(request({ ...base, targetType: "reel", targetId: "reel-1", action: "approved" }), TOKEN, deps);
    expect(result.status).toBe(201);
    expect(result.body.feedback).toMatchObject({ targetType: "reel", targetId: "reel-1" });
  });

  it("C. Story revize talebi mesajıyla kaydedilir", async () => {
    const { deps } = await setup();
    const result = await handleFeedbackPost(request({ ...base, targetType: "story", targetId: "story-1", action: "revision_requested", message: "  Logo daha büyük olsun.\nRenk koyu.  " }), TOKEN, deps);
    expect(result.status).toBe(201);
    expect(result.body.feedback).toMatchObject({ targetType: "story", action: "revision_requested", message: "Logo daha büyük olsun.\nRenk koyu." });
  });

  it("D/E. Grid onayı ve genel revize (targetId null)", async () => {
    const { deps } = await setup();
    const approved = await handleFeedbackPost(request({ ...base, targetType: "grid", targetId: null, action: "approved" }), TOKEN, deps);
    expect(approved.status).toBe(201);
    expect(approved.body.feedback).toMatchObject({ targetType: "grid", targetId: null });
    const revision = await handleFeedbackPost(request({ ...base, targetType: "grid", action: "revision_requested", message: "Genel olarak daha sade." }), TOKEN, deps);
    expect(revision.status).toBe(201);
  });

  it("F. mesajsız (veya yalnız boşluk) revize reddedilir", async () => {
    const { deps, feedbackStore } = await setup();
    for (const message of [undefined, null, "", "   \n "]) {
      const result = await handleFeedbackPost(request({ ...base, targetType: "post", targetId: "post-1", action: "revision_requested", message }), TOKEN, deps);
      expect(result.status).toBe(400);
      expect(result.body.code).toBe("FEEDBACK_MESSAGE_REQUIRED");
    }
    expect(await feedbackStore.list(TOKEN)).toEqual([]);
  });

  it("G. geçersiz action reddedilir", async () => {
    const { deps } = await setup();
    const result = await handleFeedbackPost(request({ ...base, targetType: "post", targetId: "post-1", action: "deleted" }), TOKEN, deps);
    expect(result).toMatchObject({ status: 400, body: { code: "FEEDBACK_INVALID_ACTION" } });
  });

  it("H. uydurma veya yanlış türdeki hedef reddedilir", async () => {
    const { deps, feedbackStore } = await setup();
    const cases = [
      { targetType: "post", targetId: "yok" },
      { targetType: "reel", targetId: "post-1" }, // Post, Reel olarak gönderilemez
      { targetType: "post", targetId: "reel-1" }, // Reel, Post olarak gönderilemez
      { targetType: "story", targetId: "post-1" },
      { targetType: "story", targetId: "story-9" },
    ];
    for (const target of cases) {
      const result = await handleFeedbackPost(request({ ...base, ...target, action: "approved" }), TOKEN, deps);
      expect(result).toMatchObject({ status: 400, body: { code: "FEEDBACK_UNKNOWN_TARGET" } });
    }
    expect((await handleFeedbackPost(request({ ...base, targetType: "grid", targetId: "post-1", action: "approved" }), TOKEN, deps)).status).toBe(400);
    expect((await handleFeedbackPost(request({ ...base, targetType: "video", targetId: "post-1", action: "approved" }), TOKEN, deps)).status).toBe(400);
    expect(await feedbackStore.list(TOKEN)).toEqual([]);
  });

  it("I. süresi dolmuş veya iptal edilmiş paylaşım reddedilir", async () => {
    const payload = { version: 1, token: TOKEN, createdAt: "2026-09-01T00:00:00.000Z", ...input };
    const row = (extra: Partial<SnapshotRow>): SnapshotRow => ({ token: TOKEN, version: 1, created_at: payload.createdAt, payload, expires_at: "2026-10-01T00:00:00.000Z", revoked_at: null, ...extra });
    const driver = (found: SnapshotRow) => ({ find: async () => found }) as unknown as SupabaseShareDriver;
    for (const found of [row({}), row({ expires_at: "2026-12-01T00:00:00.000Z", revoked_at: "2026-10-10T00:00:00.000Z" })]) {
      const shareStore = new SupabaseShareStore(driver(found), 30, () => TOKEN, () => NOW);
      const feedbackStore = new InMemoryShareFeedbackStore(() => NOW);
      const result = await handleFeedbackPost(request({ ...base, targetType: "post", targetId: "post-1", action: "approved" }), TOKEN, { shareStore, feedbackStore, rateLimiter: createRateLimiter({ max: 10, windowMs: 1000 }) });
      expect(result).toMatchObject({ status: 404, body: { code: "SHARE_UNAVAILABLE" } });
      expect(await feedbackStore.list(TOKEN)).toEqual([]);
    }
    // Süresi dolmamış aynı kayıt kabul edilir (sınırın doğru tarafı).
    const live = new SupabaseShareStore(driver(row({ expires_at: "2026-11-01T00:00:00.000Z" })), 30, () => TOKEN, () => NOW);
    const ok = await handleFeedbackPost(request({ ...base, targetType: "post", targetId: "post-1", action: "approved" }), TOKEN, { shareStore: live, feedbackStore: new InMemoryShareFeedbackStore(), rateLimiter: createRateLimiter({ max: 10, windowMs: 1000 }) });
    expect(ok.status).toBe(201);
  });

  it("J. geçersiz biçimli veya bilinmeyen token reddedilir", async () => {
    const { deps } = await setup();
    const body = { ...base, targetType: "grid", action: "approved" };
    expect((await handleFeedbackPost(request(body), "../../etc", deps)).status).toBe(404);
    expect((await handleFeedbackPost(request(body), "22222222-2222-4222-8222-222222222222", deps)).status).toBe(404);
  });

  it("K. çok uzun mesaj ve çok büyük gövde reddedilir", async () => {
    const { deps } = await setup();
    const long = await handleFeedbackPost(request({ ...base, targetType: "grid", action: "revision_requested", message: "a".repeat(2001) }), TOKEN, deps);
    expect(long).toMatchObject({ status: 400, body: { code: "FEEDBACK_MESSAGE_TOO_LONG" } });
    const exact = await handleFeedbackPost(request({ ...base, targetType: "grid", action: "revision_requested", message: "a".repeat(2000) }), TOKEN, deps);
    expect(exact.status).toBe(201);
    const huge = await handleFeedbackPost(request({ ...base, targetType: "grid", action: "approved", padding: "x".repeat(9000) }), TOKEN, deps);
    expect(huge).toMatchObject({ status: 413, body: { code: "FEEDBACK_TOO_LARGE" } });
  });

  it("L. created_at istemciden alınmaz; marka/plan istemciden enjekte edilemez", async () => {
    const { deps, feedbackStore } = await setup();
    const result = await handleFeedbackPost(request({
      ...base, targetType: "post", targetId: "post-1", action: "approved",
      createdAt: "2000-01-01T00:00:00.000Z", created_at: "2000-01-01T00:00:00.000Z",
      brandId: "baska-marka", projectId: "baska-plan", id: "sahte-id",
    }), TOKEN, deps);
    expect(result.status).toBe(201);
    const [stored] = await feedbackStore.list(TOKEN);
    expect(stored.createdAt).toBe(NOW.toISOString());
    expect(stored.brandId).toBe("brand-a");
    expect(stored.projectId).toBe("project-oct");
    expect(stored.id).not.toBe("sahte-id");
  });

  it("ad zorunludur ve sadeleştirilir", async () => {
    const { deps } = await setup();
    expect((await handleFeedbackPost(request({ targetType: "grid", action: "approved" }), TOKEN, deps)).body.code).toBe("FEEDBACK_NAME_REQUIRED");
    expect((await handleFeedbackPost(request({ clientName: " A ", targetType: "grid", action: "approved" }), TOKEN, deps)).body.code).toBe("FEEDBACK_NAME_REQUIRED");
    const ok = await handleFeedbackPost(request({ clientName: "  Ayşe   Yılmaz ", targetType: "grid", action: "approved" }), TOKEN, deps);
    expect(ok.body.feedback).toMatchObject({ clientName: "Ayşe Yılmaz" });
  });

  it("bozuk JSON reddedilir", async () => {
    const { deps } = await setup();
    expect((await handleFeedbackPost(request("{bozuk"), TOKEN, deps)).status).toBe(400);
  });

  it("eski (context'siz) paylaşımda geri bildirim markasız kaydedilir", async () => {
    const { context: _context, ...legacy } = input;
    const { deps, feedbackStore } = await setup({}, legacy);
    expect((await handleFeedbackPost(request({ ...base, targetType: "grid", action: "approved" }), TOKEN, deps)).status).toBe(201);
    expect((await feedbackStore.list(TOKEN))[0]).toMatchObject({ brandId: null, projectId: null });
  });
});

describe("geçmiş ve son durum", () => {
  it("M/N. aynı hedefe birden çok geri bildirim: geçmiş korunur, son durum en yenisidir", async () => {
    let clock = new Date("2026-10-14T10:00:00.000Z");
    const shareStore = new InMemoryShareStore(() => TOKEN, () => NOW);
    await shareStore.create(input);
    const feedbackStore = new InMemoryShareFeedbackStore(() => clock);
    const deps: FeedbackApiDeps = { shareStore, feedbackStore, rateLimiter: createRateLimiter({ max: 100, windowMs: 60_000 }), now: () => clock };

    await handleFeedbackPost(request({ ...base, targetType: "post", targetId: "post-1", action: "approved" }), TOKEN, deps);
    clock = new Date("2026-10-14T11:00:00.000Z");
    await handleFeedbackPost(request({ ...base, clientName: "Mehmet Kaya", targetType: "post", targetId: "post-1", action: "revision_requested", message: "Başlık değişsin." }), TOKEN, deps);
    clock = new Date("2026-10-14T11:30:00.000Z");
    await handleFeedbackPost(request({ ...base, targetType: "reel", targetId: "reel-1", action: "revision_requested", message: "Müzik değişsin." }), TOKEN, deps);
    clock = new Date("2026-10-14T12:00:00.000Z");
    await handleFeedbackPost(request({ ...base, targetType: "reel", targetId: "reel-1", action: "approved" }), TOKEN, deps);

    const history = await feedbackStore.list(TOKEN);
    expect(history.map((record) => [record.targetId, record.action])).toEqual([
      ["post-1", "approved"],
      ["post-1", "revision_requested"],
      ["reel-1", "revision_requested"],
      ["reel-1", "approved"],
    ]);

    const latest = await handleFeedbackGet(TOKEN, deps);
    expect(latest.status).toBe(200);
    const byTarget = Object.fromEntries((latest.body.latest as Array<{ targetId: string; action: string; clientName: string }>).map((record) => [record.targetId, [record.action, record.clientName]]));
    expect(byTarget).toEqual({ "post-1": ["revision_requested", "Mehmet Kaya"], "reel-1": ["approved", "Ayşe Yılmaz"] });
    // Müşteriye giden kayıtta iç alanlar yok.
    expect(JSON.stringify(latest.body)).not.toContain("brand-a");
  });

  it("GET geçersiz token için 404", async () => {
    const { deps } = await setup();
    expect((await handleFeedbackGet("22222222-2222-4222-8222-222222222222", deps)).status).toBe(404);
  });
});

describe("spam koruması", () => {
  it("aynı IP + paylaşım için süreç içi sınır aşılınca 429", async () => {
    const { deps } = await setup({ rateLimiter: createRateLimiter({ max: 2, windowMs: 60_000 }) });
    const body = { ...base, targetType: "grid", action: "approved" };
    expect((await handleFeedbackPost(request(body), TOKEN, deps)).status).toBe(201);
    expect((await handleFeedbackPost(request(body), TOKEN, deps)).status).toBe(201);
    expect((await handleFeedbackPost(request(body), TOKEN, deps))).toMatchObject({ status: 429, body: { code: "FEEDBACK_RATE_LIMITED" } });
    // Farklı IP etkilenmez.
    expect((await handleFeedbackPost(request(body, "198.51.100.7"), TOKEN, deps)).status).toBe(201);
  });

  it("paylaşım başına kalıcı saatlik üst sınır (yeniden başlatmaya dayanıklı) 429 döner", async () => {
    const { deps } = await setup({ maxPerShareHour: 2 });
    const body = { ...base, targetType: "grid", action: "approved" };
    await handleFeedbackPost(request(body, "198.51.100.1"), TOKEN, deps);
    await handleFeedbackPost(request(body, "198.51.100.2"), TOKEN, deps);
    expect((await handleFeedbackPost(request(body, "198.51.100.3"), TOKEN, deps)).status).toBe(429);
  });

  it("geçersiz istekler de süreç içi sınıra sayılır (kaba deneme koruması)", async () => {
    const { deps } = await setup({ rateLimiter: createRateLimiter({ max: 1, windowMs: 60_000 }) });
    await handleFeedbackPost(request("{bozuk"), TOKEN, deps);
    expect((await handleFeedbackPost(request({ ...base, targetType: "grid", action: "approved" }), TOKEN, deps)).status).toBe(429);
  });
});
