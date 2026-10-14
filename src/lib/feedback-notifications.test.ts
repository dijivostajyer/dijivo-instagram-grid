import { describe, expect, it } from "vitest";

import { feedbackNotificationText, formatBadgeCount, markItemsRead, messagePreview, toNotificationItem } from "./feedback-notifications";

describe("rozet sayısı", () => {
  it("C/D/E. 0 → rozet yok; 1–99 → sayı; 99 üzeri → 99+", () => {
    expect(formatBadgeCount(0)).toBeNull();
    expect(formatBadgeCount(-3)).toBeNull();
    expect(formatBadgeCount(Number.NaN)).toBeNull();
    expect(formatBadgeCount(1)).toBe("1");
    expect(formatBadgeCount(5)).toBe("5");
    expect(formatBadgeCount(99)).toBe("99");
    expect(formatBadgeCount(100)).toBe("99+");
    expect(formatBadgeCount(120)).toBe("99+");
  });
});

describe("bildirim metinleri", () => {
  const text = (targetType: "post" | "reel" | "story" | "grid", action: "approved" | "revision_requested", month: string | null = null) =>
    feedbackNotificationText({ brandName: "Moda Butik", monthLabel: month, targetType, action });

  it("G. Post revizesi", () => {
    expect(text("post", "revision_requested")).toBe("Moda Butik, bir Post için revize istedi.");
    expect(text("post", "revision_requested", "Ekim 2026")).toBe("Moda Butik, Ekim 2026 planındaki Post için revize istedi.");
  });

  it("H. Reel onayı (Türkçe ek)", () => {
    expect(text("reel", "approved")).toBe("Moda Butik, bir Reel'i onayladı.");
    expect(text("reel", "approved", "Ekim 2026")).toBe("Moda Butik, Ekim 2026 planındaki Reel'i onayladı.");
    expect(text("reel", "revision_requested", "Ekim 2026")).toBe("Moda Butik, Ekim 2026 planındaki Reel için revize istedi.");
  });

  it("I. Story revizesi ve onayı", () => {
    expect(text("story", "revision_requested")).toBe("Moda Butik, bir Story için revize istedi.");
    expect(text("story", "approved", "Eylül 2026")).toBe("Moda Butik, Eylül 2026 planındaki Story'yi onayladı.");
    expect(text("post", "approved")).toBe("Moda Butik, bir Post'u onayladı.");
  });

  it("J. Grid onayı ve genel revize", () => {
    expect(text("grid", "approved")).toBe("Moda Butik, grid planını onayladı.");
    expect(text("grid", "approved", "Ekim 2026")).toBe("Moda Butik, Ekim 2026 grid planını onayladı.");
    expect(text("grid", "revision_requested")).toBe("Moda Butik, grid için genel revize istedi.");
    expect(text("grid", "revision_requested", "Ekim 2026")).toBe("Moda Butik, Ekim 2026 gridi için genel revize istedi.");
  });
});

describe("hafif bildirim öğesi", () => {
  it("mesaj özeti tek satır ve en fazla 140 karakter", () => {
    expect(messagePreview(null)).toBeNull();
    expect(messagePreview("  \n ")).toBeNull();
    expect(messagePreview("Başlık\n\nfiyat  eklensin")).toBe("Başlık fiyat eklensin");
    const long = messagePreview("a".repeat(300))!;
    expect(long.length).toBe(140);
    expect(long.endsWith("…")).toBe(true);
  });

  it("öğe medya veya paylaşım alanı içermez", () => {
    const item = toNotificationItem({
      id: "1", shareToken: "t", brandId: "b", projectId: "p", targetType: "reel", targetId: "r", action: "approved", message: null,
      clientName: "Ayşe", createdAt: "2026-10-14T10:00:00.000Z", workflowStatus: "new", workflowUpdatedAt: null, readAt: null,
    });
    expect(Object.keys(item).sort()).toEqual(["action", "brandId", "clientName", "createdAt", "id", "messagePreview", "projectId", "readAt", "targetId", "targetType"]);
  });

  it("yerel okundu işareti yalnız verilen/okunmamış kayıtlara uygulanır; mevcut tarih korunur", () => {
    const base = { brandId: null, projectId: null, targetType: "post" as const, targetId: "x", action: "approved" as const, messagePreview: null, clientName: "A", createdAt: "2026-10-14T10:00:00.000Z" };
    const items = [{ ...base, id: "1", readAt: null }, { ...base, id: "2", readAt: null }, { ...base, id: "3", readAt: "2026-10-01T00:00:00.000Z" }];
    expect(markItemsRead(items, ["1"], "NOW").map((item) => item.readAt)).toEqual(["NOW", null, "2026-10-01T00:00:00.000Z"]);
    expect(markItemsRead(items, "all", "NOW").map((item) => item.readAt)).toEqual(["NOW", "NOW", "2026-10-01T00:00:00.000Z"]);
  });
});
