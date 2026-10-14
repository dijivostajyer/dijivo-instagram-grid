import { describe, expect, it } from "vitest";

import {
  feedbackTargetKey,
  feedbackTargetTypeForPost,
  formatFeedbackTime,
  isFeedbackTargetInSnapshot,
  latestFeedbackByTarget,
  validateFeedbackRequest,
} from "./share-feedback";

describe("validateFeedbackRequest", () => {
  it("onayda mesaj opsiyonel; kontrol karakterleri temizlenir, satır sonu korunur", () => {
    const result = validateFeedbackRequest({ targetType: "post", targetId: "p1", action: "approved", clientName: "Ayşe\u0007 Yılmaz", message: " Güzel \n olmuş\u0000 " });
    expect(result).toEqual({ ok: true, value: { targetType: "post", targetId: "p1", action: "approved", clientName: "Ayşe Yılmaz", message: "Güzel \n olmuş" } });
  });

  it("grid hedefi kimliksizdir; diğerleri kimlik ister", () => {
    expect(validateFeedbackRequest({ targetType: "grid", action: "approved", clientName: "Ali Veli" }).ok).toBe(true);
    expect(validateFeedbackRequest({ targetType: "grid", targetId: "x", action: "approved", clientName: "Ali Veli" }).ok).toBe(false);
    expect(validateFeedbackRequest({ targetType: "story", targetId: "", action: "approved", clientName: "Ali Veli" }).ok).toBe(false);
    expect(validateFeedbackRequest({ targetType: "story", targetId: "x".repeat(201), action: "approved", clientName: "Ali Veli" }).ok).toBe(false);
  });

  it("dizi veya nesne olmayan gövde ve uzun ad reddedilir", () => {
    expect(validateFeedbackRequest([]).ok).toBe(false);
    expect(validateFeedbackRequest(null).ok).toBe(false);
    expect(validateFeedbackRequest({ targetType: "grid", action: "approved", clientName: "a".repeat(81) })).toMatchObject({ ok: false, code: "FEEDBACK_NAME_TOO_LONG" });
    expect(validateFeedbackRequest({ targetType: "grid", action: "approved", clientName: "Ali", message: 5 })).toMatchObject({ ok: false, code: "FEEDBACK_INVALID_MESSAGE" });
  });
});

describe("hedefler ve son durum", () => {
  const snapshot = {
    cells: [
      { id: "p1", source: "mevcut" as const, imageUrl: "x", position: 0, row: 0, column: 0, pinned: false, postType: "post" as const },
      { id: "c1", source: "mevcut" as const, imageUrl: "x", position: 1, row: 0, column: 1, pinned: false, postType: "carousel" as const },
      { id: "r1", source: "planlanan" as const, imageUrl: "x", position: 2, row: 0, column: 2, pinned: false, postType: "reel" as const },
    ],
    stories: [{ id: "s1", mediaType: "image" as const, mediaUrl: "x", sortOrder: 0 }],
  };

  it("hedef türü snapshot ile tutarlı olmalı", () => {
    expect(isFeedbackTargetInSnapshot(snapshot, "post", "c1")).toBe(true);
    expect(isFeedbackTargetInSnapshot(snapshot, "reel", "r1")).toBe(true);
    expect(isFeedbackTargetInSnapshot(snapshot, "reel", "p1")).toBe(false);
    expect(isFeedbackTargetInSnapshot(snapshot, "story", "s1")).toBe(true);
    expect(isFeedbackTargetInSnapshot({ cells: snapshot.cells }, "story", "s1")).toBe(false);
    expect(isFeedbackTargetInSnapshot(snapshot, "grid", null)).toBe(true);
    expect(feedbackTargetTypeForPost("carousel")).toBe("post");
    expect(feedbackTargetTypeForPost("reel")).toBe("reel");
  });

  it("son durum: zamana göre en yeni; eşit zamanda ekleme sırası; hedefler ayrı", () => {
    const records = [
      { id: "3", targetType: "post" as const, targetId: "p1", action: "approved" as const, createdAt: "2026-10-14T12:00:00.000Z" },
      { id: "1", targetType: "post" as const, targetId: "p1", action: "revision_requested" as const, createdAt: "2026-10-14T10:00:00.000Z" },
      { id: "4", targetType: "grid" as const, targetId: null, action: "approved" as const, createdAt: "2026-10-14T09:00:00.000Z" },
      { id: "5", targetType: "grid" as const, targetId: null, action: "revision_requested" as const, createdAt: "2026-10-14T09:00:00.000Z" },
    ];
    const latest = latestFeedbackByTarget(records);
    expect(latest.get(feedbackTargetKey("post", "p1"))?.id).toBe("3");
    expect(latest.get("grid")?.id).toBe("5");
    expect(latest.size).toBe(2);
    // Girdi değiştirilmez (audit trail).
    expect(records.map((record) => record.id)).toEqual(["3", "1", "4", "5"]);
  });

  it("tarih UTC'den yerel saate biçimlenir; sabit saat dilimi kullanılmaz", () => {
    const value = "2026-10-14T09:05:00.000Z";
    expect(formatFeedbackTime(value)).toBe(new Date(value).toLocaleString("tr-TR", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }));
    expect(formatFeedbackTime("bozuk")).toBe("");
  });
});
