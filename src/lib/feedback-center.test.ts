import { describe, expect, it, vi } from "vitest";

import {
  buildFeedbackTimeline,
  extractSnapshotTarget,
  feedbackListQueryToParams,
  formatFeedbackDateTime,
  isSameFeedbackTarget,
  parseFeedbackListQuery,
  resolveFeedbackNavigation,
  sanitizeFeedbackSearch,
  type FeedbackCenterRecord,
  type FeedbackListQuery,
} from "./feedback-center";
import {
  InMemoryFeedbackCenterDriver,
  getFeedbackCenterDetail,
  handleMarkRead,
  handleWorkflowUpdate,
  listFeedbackCenter,
  type FeedbackSnapshotRow,
} from "./feedback-center-server";
import { latestFeedbackByTarget } from "./share-feedback";

const ME = "00000000-0000-4000-8000-000000000001";
const OTHER = "00000000-0000-4000-8000-000000000002";
const T1 = "11111111-1111-4111-8111-111111111111";
const T2 = "22222222-2222-4222-8222-222222222222";
const NOW = new Date("2026-10-14T12:00:00.000Z");

const snapshotPayload = (token: string) => ({
  version: 1,
  token,
  createdAt: "2026-10-10T09:00:00.000Z",
  brand: { name: "Marka", username: "marka" },
  cells: [
    { id: "post-1", source: "mevcut", imageUrl: `storage:shares/${token}/post.jpg`, position: 0, row: 0, column: 0, pinned: false, postType: "post", caption: "Ekim kampanyası", alt: "Post 1" },
    { id: "reel-1", source: "planlanan", imageUrl: `storage:shares/${token}/reel-frame.jpg`, coverImageUrl: `storage:shares/${token}/reel-cover.jpg`, videoUrl: `storage:media/${token}/reel.mp4`, mediaType: "video", position: 1, row: 0, column: 1, pinned: false, postType: "reel" },
  ],
  stories: [
    { id: "story-1", mediaType: "image", mediaUrl: `storage:shares/${token}/story.jpg`, sortOrder: 0 },
    { id: "story-v", mediaType: "video", mediaUrl: `storage:media/${token}/story.mp4`, sortOrder: 1 },
  ],
});

let seq = 0;
function rec(overrides: Partial<FeedbackCenterRecord> & { userId?: string | null } = {}): FeedbackCenterRecord & { userId: string | null } {
  seq += 1;
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    userId: ME,
    shareToken: T1,
    brandId: "brand-a",
    projectId: "p-oct",
    targetType: "post",
    targetId: "post-1",
    action: "approved",
    message: null,
    clientName: "Ayşe Yılmaz",
    createdAt: new Date(Date.UTC(2026, 9, 14, 9, seq)).toISOString(),
    workflowStatus: "new",
    workflowUpdatedAt: null,
    readAt: null,
    ...overrides,
  };
}

function driverWith(records: Array<FeedbackCenterRecord & { userId: string | null }>, snapshots: FeedbackSnapshotRow[] = [
  { token: T1, payload: snapshotPayload(T1), createdAt: "2026-10-10T09:00:00.000Z", expiresAt: "2026-11-09T09:00:00.000Z", revokedAt: null },
]) {
  return new InMemoryFeedbackCenterDriver(records, new Map(snapshots.map((row) => [row.token, row])), () => NOW);
}

const query = (extra: Partial<FeedbackListQuery> = {}): FeedbackListQuery => ({ order: "desc", limit: 50, offset: 0, ...extra });

describe("liste: sahiplik, sıralama, önizleme", () => {
  it("A. yalnız kullanıcının kendi geri bildirimleri gelir (markasız/başka kullanıcı yok)", async () => {
    const mine = rec();
    const driver = driverWith([mine, rec({ userId: OTHER, brandId: "brand-x" }), rec({ userId: null, brandId: null })]);
    const result = await listFeedbackCenter(ME, query(), driver, NOW);
    expect(result.items.map((item) => item.id)).toEqual([mine.id]);
    expect(result.unreadCount).toBe(1);
    expect(JSON.stringify(result)).not.toContain(OTHER);
  });

  it("B. en yeni üstte; 'En eski' seçilince tersi", async () => {
    const first = rec();
    const second = rec();
    const third = rec();
    const driver = driverWith([second, third, first]);
    expect((await listFeedbackCenter(ME, query(), driver, NOW)).items.map((item) => item.id)).toEqual([third.id, second.id, first.id]);
    expect((await listFeedbackCenter(ME, query({ order: "asc" }), driver, NOW)).items.map((item) => item.id)).toEqual([first.id, second.id, third.id]);
  });

  it("C/D/E/F. Post, Reel (kapak), Story (görsel/video) ve grid önizlemeleri imzalı URL ile gelir", async () => {
    const driver = driverWith([
      rec({ targetType: "post", targetId: "post-1" }),
      rec({ targetType: "reel", targetId: "reel-1" }),
      rec({ targetType: "story", targetId: "story-1" }),
      rec({ targetType: "story", targetId: "story-v" }),
      rec({ targetType: "grid", targetId: null }),
    ]);
    const sign = vi.spyOn(driver, "sign");
    const items = (await listFeedbackCenter(ME, query({ order: "asc" }), driver, NOW)).items;
    expect(items[0].preview).toEqual({ kind: "image", url: `https://signed.test/shares/${T1}/post.jpg`, postType: "post", caption: "Ekim kampanyası", alt: "Post 1" });
    expect(items[1].preview).toMatchObject({ kind: "image", url: `https://signed.test/shares/${T1}/reel-cover.jpg`, postType: "reel" });
    expect(items[2].preview).toMatchObject({ kind: "image", url: `https://signed.test/shares/${T1}/story.jpg` });
    expect(items[3].preview).toMatchObject({ kind: "video", url: `https://signed-media.test/media/${T1}/story.mp4` });
    expect(items[4].preview).toEqual({ kind: "grid", cellCount: 2 });
    expect(items[0].share).toEqual({ token: T1, createdAt: "2026-10-10T09:00:00.000Z", expiresAt: "2026-11-09T09:00:00.000Z", status: "active" });
    // Yalnız hedef medyalar, tek toplu imzalama çağrısıyla (video gövdesi değil, kapak).
    expect(sign).toHaveBeenCalledTimes(1);
    expect(sign.mock.calls[0][0].images.sort()).toEqual([`shares/${T1}/post.jpg`, `shares/${T1}/reel-cover.jpg`, `shares/${T1}/story.jpg`]);
    expect(sign.mock.calls[0][0].media).toEqual([`media/${T1}/story.mp4`]);
  });

  it("T. eksik/bozuk snapshot, silinmiş hedef veya imzalama hatası çökme yerine yedek önizleme verir", async () => {
    const driver = driverWith(
      [rec({ shareToken: T2 }), rec({ targetId: "silinmis" }), rec({ shareToken: "33333333-3333-4333-8333-333333333333" })],
      [
        { token: T1, payload: snapshotPayload(T1), createdAt: null, expiresAt: "2026-10-01T00:00:00.000Z", revokedAt: null },
        { token: T2, payload: { bozuk: true }, createdAt: null, expiresAt: null, revokedAt: "2026-10-12T00:00:00.000Z" },
      ],
    );
    const items = (await listFeedbackCenter(ME, query({ order: "asc" }), driver, NOW)).items;
    expect(items.map((item) => item.preview.kind)).toEqual(["unavailable", "unavailable", "unavailable"]);
    expect(items.map((item) => item.share.status)).toEqual(["revoked", "expired", "missing"]);

    const failing = driverWith([rec()]);
    vi.spyOn(failing, "sign").mockRejectedValue(new Error("storage kapalı"));
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect((await listFeedbackCenter(ME, query(), failing, NOW)).items[0].preview.kind).toBe("unavailable");
  });

  it("sayfalama: limit, hasMore ve nextOffset", async () => {
    const driver = driverWith(Array.from({ length: 5 }, () => rec()));
    const first = await listFeedbackCenter(ME, query({ limit: 2 }), driver, NOW);
    expect(first.items).toHaveLength(2);
    expect(first).toMatchObject({ hasMore: true, nextOffset: 2 });
    const last = await listFeedbackCenter(ME, query({ limit: 2, offset: 4 }), driver, NOW);
    expect(last).toMatchObject({ hasMore: false, nextOffset: 5 });
  });
});

describe("filtreler ve arama", () => {
  const records = () => [
    rec({ brandId: "brand-a", projectId: "p-oct", targetType: "post", action: "approved", clientName: "Ayşe Yılmaz" }),
    rec({ brandId: "brand-a", projectId: "p-sep", targetType: "reel", targetId: "reel-1", action: "revision_requested", message: "Müzik değişsin", workflowStatus: "in_review", readAt: "2026-10-14T10:00:00.000Z" }),
    rec({ brandId: "brand-b", projectId: "p-b-oct", targetType: "story", targetId: "story-1", action: "revision_requested", message: "Logo büyüsün", clientName: "Mehmet Kaya" }),
    rec({ brandId: "brand-b", projectId: "p-b-oct", targetType: "grid", targetId: null, action: "approved", clientName: "Mehmet Kaya", workflowStatus: "closed" }),
  ];
  const ids = async (extra: Partial<FeedbackListQuery>) => {
    const all = records();
    const result = await listFeedbackCenter(ME, query({ order: "asc", ...extra }), driverWith(all), NOW);
    return result.items.map((item) => all.findIndex((record) => record.id === item.id));
  };

  it("K. marka", async () => expect(await ids({ brandId: "brand-b" })).toEqual([2, 3]));
  it("L. ay (plan kimlikleri)", async () => expect(await ids({ projectIds: ["p-oct", "p-b-oct"] })).toEqual([0, 2, 3]));
  it("M. içerik tipi", async () => {
    expect(await ids({ targetType: "story" })).toEqual([2]);
    expect(await ids({ targetType: "grid" })).toEqual([3]);
  });
  it("N. müşteri durumu, iş akışı ve okunmamış", async () => {
    expect(await ids({ action: "revision_requested" })).toEqual([1, 2]);
    expect(await ids({ workflowStatus: "closed" })).toEqual([3]);
    expect(await ids({ unreadOnly: true })).toEqual([0, 2, 3]);
  });
  it("O. arama: müşteri adı, mesaj (Türkçe büyük/küçük harf) ve marka eşleşmesi", async () => {
    expect(await ids({ q: "MEHMET" })).toEqual([2, 3]);
    expect(await ids({ q: "müzik" })).toEqual([1]);
    expect(await ids({ q: "dijivo", qBrandIds: ["brand-a"] })).toEqual([0, 1]);
    expect(await ids({ q: "yok-boyle-bir-sey" })).toEqual([]);
  });

  it("sorgu parametreleri ayrıştırılır; geçersiz değerler yok sayılır, sınırlar uygulanır", () => {
    const parsed = parseFeedbackListQuery(new URLSearchParams("brandId=brand-a&projectIds=p1,p 2,p3&targetType=video&action=approved&workflow=revision_done&unread=1&q=a,(b)*%25&order=asc&limit=500&offset=-3"));
    expect(parsed).toEqual({ brandId: "brand-a", projectIds: ["p1", "p3"], action: "approved", workflowStatus: "revision_done", unreadOnly: true, q: "a b", order: "asc", limit: 100, offset: 0 });
    expect(parseFeedbackListQuery(feedbackListQueryToParams({ brandId: "b", q: "Ayşe", order: "desc", limit: 50, offset: 50 }))).toEqual({ brandId: "b", q: "Ayşe", order: "desc", limit: 50, offset: 50 });
    expect(sanitizeFeedbackSearch("a")).toBeUndefined();
    expect(sanitizeFeedbackSearch(" client_name.ilike.*x*,id.eq.1 ")).toBe("client name.ilike. x id.eq.1");
  });
});

describe("detay, geçmiş, okundu ve iş akışı", () => {
  it("I/J. aynı hedefin geçmişi kronolojik; son durum en yenisi; diğer hedefler karışmaz", async () => {
    const approved = rec({ action: "approved" });
    const revision = rec({ action: "revision_requested", message: "Başlığı değiştirelim." });
    const otherTarget = rec({ targetId: "reel-1", targetType: "reel" });
    const otherUser = rec({ userId: OTHER });
    const later = rec({ action: "revision_requested", message: "Renkler koyu.", shareToken: T2 }); // aynı post, yeni paylaşım
    const driver = driverWith([later, otherTarget, revision, approved, otherUser]);
    const detail = await getFeedbackCenterDetail(ME, revision.id, driver, NOW);
    expect(detail?.history.map((item) => item.id)).toEqual([approved.id, revision.id, later.id]);
    expect([...latestFeedbackByTarget(detail!.history).values()].map((item) => item.id)).toEqual([later.id]);
    expect(await getFeedbackCenterDetail(ME, otherUser.id, driver, NOW)).toBeNull();
  });

  it("grid geçmişi aynı aylık plana göre", () => {
    const a = rec({ targetType: "grid", targetId: null, projectId: "p-oct", shareToken: T1 });
    const b = rec({ targetType: "grid", targetId: null, projectId: "p-oct", shareToken: T2 });
    const c = rec({ targetType: "grid", targetId: null, projectId: "p-sep" });
    expect(isSameFeedbackTarget(a, b)).toBe(true);
    expect(isSameFeedbackTarget(a, c)).toBe(false);
  });

  it("P. okundu: yalnız kendi ve okunmamış kayıtlar; tarih bir kez yazılır; sayaç döner", async () => {
    const unread = rec();
    const alreadyRead = rec({ readAt: "2026-10-01T00:00:00.000Z" });
    const foreign = rec({ userId: OTHER });
    const driver = driverWith([unread, alreadyRead, foreign]);
    const result = await handleMarkRead(ME, { ids: [unread.id, alreadyRead.id, foreign.id] }, driver);
    expect(result).toEqual({ status: 200, body: { ids: [unread.id], unreadCount: 0 } });
    expect(driver.records.find((item) => item.id === alreadyRead.id)?.readAt).toBe("2026-10-01T00:00:00.000Z");
    expect(driver.records.find((item) => item.id === foreign.id)?.readAt).toBeNull();
    expect((await handleMarkRead(ME, { ids: [] }, driver)).status).toBe(400);
    expect((await handleMarkRead(ME, { ids: "x" }, driver)).status).toBe(400);
  });

  it("Q/R. iş akışı: Revize Tamamlandı iç durumu değiştirir, müşteri eylemi ve mesajı aynen kalır, iç olay eklenir", async () => {
    const revision = rec({ action: "revision_requested", message: "Başlığı değiştirelim." });
    const driver = driverWith([revision]);
    const result = await handleWorkflowUpdate(ME, revision.id, { workflowStatus: "revision_done" }, driver);
    expect(result.status).toBe(200);
    expect(result.body.record).toMatchObject({ action: "revision_requested", message: "Başlığı değiştirelim.", workflowStatus: "revision_done", workflowUpdatedAt: NOW.toISOString(), readAt: NOW.toISOString() });
    await handleWorkflowUpdate(ME, revision.id, { workflowStatus: "closed" }, driver);
    const detail = await getFeedbackCenterDetail(ME, revision.id, driver, NOW);
    expect(detail?.events.map((event) => event.status)).toEqual(["revision_done", "closed"]);
    const timeline = buildFeedbackTimeline(detail!.history, detail!.events);
    expect(timeline.map((entry) => entry.kind)).toEqual(["customer", "workflow", "workflow"]);
    expect((await handleWorkflowUpdate(ME, revision.id, { workflowStatus: "approved" }, driver)).status).toBe(400);
    expect((await handleWorkflowUpdate(OTHER, revision.id, { workflowStatus: "closed" }, driver)).status).toBe(404);
  });
});

describe("yardımcılar", () => {
  it("snapshot hedefi: bulunamayan, bozuk ve grid", () => {
    expect(extractSnapshotTarget(snapshotPayload(T1), "story", "yok")).toEqual({ kind: "unavailable" });
    expect(extractSnapshotTarget(null, "post", "post-1")).toEqual({ kind: "unavailable" });
    expect(extractSnapshotTarget({ version: 99 }, "grid", null)).toEqual({ kind: "unavailable" });
    expect(extractSnapshotTarget(snapshotPayload(T1), "grid", null)).toEqual({ kind: "grid", cellCount: 2 });
  });

  it("S. Projeye Git: doğru plan; Post varsa modal, Story için Story sekmesi; plan yoksa null", () => {
    const projects = [{ id: "p-oct", brandId: "brand-a", existingPosts: [{ id: "post-1" }], plannedPosts: [{ id: "reel-1" }] }];
    expect(resolveFeedbackNavigation(projects, { brandId: "brand-a", projectId: "p-oct", targetType: "reel", targetId: "reel-1" })).toEqual({ brandId: "brand-a", projectId: "p-oct", postId: "reel-1", openStories: false });
    expect(resolveFeedbackNavigation(projects, { brandId: "brand-a", projectId: "p-oct", targetType: "post", targetId: "silinmis" })).toEqual({ brandId: "brand-a", projectId: "p-oct", postId: null, openStories: false });
    expect(resolveFeedbackNavigation(projects, { brandId: "brand-a", projectId: "p-oct", targetType: "story", targetId: "story-1" })).toMatchObject({ postId: null, openStories: true });
    expect(resolveFeedbackNavigation(projects, { brandId: "brand-a", projectId: "p-oct", targetType: "grid", targetId: null })).toMatchObject({ postId: null, openStories: false });
    expect(resolveFeedbackNavigation(projects, { brandId: "brand-a", projectId: "p-yok", targetType: "post", targetId: "post-1" })).toBeNull();
  });

  it("tarih: '14 Ekim 2026, 13:42' biçimi, yerel saat (sabit saat dilimi yok)", () => {
    const value = "2026-10-14T10:42:00.000Z";
    const date = new Date(value);
    expect(formatFeedbackDateTime(value)).toBe(`${date.toLocaleDateString("tr-TR", { day: "numeric", month: "long", year: "numeric" })}, ${date.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })}`);
    expect(formatFeedbackDateTime(value)).toMatch(/^\d{1,2} Ekim 2026, \d{2}:\d{2}$/);
    expect(formatFeedbackDateTime("bozuk")).toBe("");
  });
});
