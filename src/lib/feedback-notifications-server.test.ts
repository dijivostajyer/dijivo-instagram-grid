import { describe, expect, it, vi } from "vitest";

import type { FeedbackCenterRecord } from "./feedback-center";
import { InMemoryFeedbackCenterDriver, getNotificationSummary, handleMarkAllRead, handleMarkRead } from "./feedback-center-server";

const ME = "00000000-0000-4000-8000-000000000001";
const OTHER = "99999999-9999-4999-8999-999999999999";
const NOW = new Date("2026-10-14T12:00:00.000Z");

let seq = 0;
function rec(overrides: Partial<FeedbackCenterRecord> & { userId?: string | null } = {}): FeedbackCenterRecord & { userId: string | null } {
  seq += 1;
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    userId: ME, shareToken: "11111111-1111-4111-8111-111111111111", brandId: "brand-a", projectId: "p-oct",
    targetType: "post", targetId: "post-1", action: "revision_requested", message: "Başlığı değiştirelim.", clientName: "Ayşe",
    createdAt: new Date(Date.UTC(2026, 9, 14, 9, seq)).toISOString(), workflowStatus: "new", workflowUpdatedAt: null, readAt: null,
    ...overrides,
  };
}

const driverOf = (records: Array<FeedbackCenterRecord & { userId: string | null }>) => new InMemoryFeedbackCenterDriver(records, new Map(), () => NOW);

describe("GET /api/feedback/unread özeti", () => {
  it("A/B. okunmamış sayısı yalnız kullanıcının kendi kayıtlarından", async () => {
    const mine = [rec(), rec(), rec({ readAt: "2026-10-14T10:00:00.000Z" })];
    const driver = driverOf([...mine, rec({ userId: OTHER }), rec({ userId: OTHER }), rec({ userId: null })]);
    const summary = await getNotificationSummary(ME, null, driver);
    expect(summary.count).toBe(2);
    expect(summary.items.map((item) => item.id).sort()).toEqual(mine.map((record) => record.id).sort());
  });

  it("F. son bildirimler en yeni üstte; varsayılan 8, en fazla 20", async () => {
    const records = Array.from({ length: 25 }, () => rec());
    const driver = driverOf([...records].reverse());
    const summary = await getNotificationSummary(ME, null, driver);
    expect(summary.items).toHaveLength(8);
    expect(summary.items.map((item) => item.id)).toEqual(records.slice(-8).reverse().map((record) => record.id));
    expect((await getNotificationSummary(ME, "100", driver)).items).toHaveLength(20);
    expect((await getNotificationSummary(ME, "x", driver)).items).toHaveLength(8);
  });

  it("öğeler medya imzalamaz ve snapshot okumaz (hafif yoklama)", async () => {
    const driver = driverOf([rec()]);
    const sign = vi.spyOn(driver, "sign");
    const snapshots = vi.spyOn(driver, "snapshots");
    const summary = await getNotificationSummary(ME, null, driver);
    expect(sign).not.toHaveBeenCalled();
    expect(snapshots).not.toHaveBeenCalled();
    expect(summary.items[0]).toMatchObject({ messagePreview: "Başlığı değiştirelim.", readAt: null });
    expect(summary.items[0]).not.toHaveProperty("preview");
  });
});

describe("okundu işaretleri", () => {
  it("L/M. tek kayıt okundu: yalnız o kayıt; diğer okunmamışlar ve created_at aynı kalır", async () => {
    const clicked = rec();
    const others = [rec(), rec({ targetId: "reel-1", targetType: "reel" })];
    const driver = driverOf([clicked, ...others]);
    const createdBefore = driver.records.map((record) => record.createdAt);
    const result = await handleMarkRead(ME, { ids: [clicked.id] }, driver);
    expect(result.body).toEqual({ ids: [clicked.id], unreadCount: 2 });
    expect(driver.records.map((record) => Boolean(record.readAt))).toEqual([true, false, false]);
    expect(driver.records.map((record) => record.createdAt)).toEqual(createdBefore);
  });

  it("N/S. Tümünü Okundu Yap yalnız kullanıcının okunmamışlarını etkiler; okunmuşların tarihi değişmez", async () => {
    const alreadyRead = rec({ readAt: "2026-10-01T00:00:00.000Z" });
    const foreign = rec({ userId: OTHER });
    const driver = driverOf([rec(), rec(), alreadyRead, foreign]);
    const result = await handleMarkAllRead(ME, driver);
    expect(result).toEqual({ status: 200, body: { updated: 2, unreadCount: 0 } });
    expect(driver.records.find((record) => record.id === alreadyRead.id)?.readAt).toBe("2026-10-01T00:00:00.000Z");
    expect(driver.records.find((record) => record.id === foreign.id)?.readAt).toBeNull();
    expect((await getNotificationSummary(OTHER, null, driver)).count).toBe(1);
  });

  it("S. başka kullanıcının kaydını okundu yapamaz", async () => {
    const foreign = rec({ userId: OTHER });
    const driver = driverOf([foreign]);
    expect((await handleMarkRead(ME, { ids: [foreign.id] }, driver)).body).toEqual({ ids: [], unreadCount: 0 });
    expect(driver.records[0].readAt).toBeNull();
  });
});
