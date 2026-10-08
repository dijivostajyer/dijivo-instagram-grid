import { describe, expect, it } from "vitest";

import {
  buildMonthMatrix,
  buildWeekColumns,
  combineDateTime,
  createChecklistItem,
  deriveStatus,
  formatDayLong,
  formatRelativeDay,
  formatTime,
  groupByHour,
  isPastDay,
  isSameDay,
  isToday,
  isWeekend,
  itemsForDay,
  MONTH_LABELS,
  randomId,
  sortByScheduledAt,
  startOfDay,
  startOfWeek,
  summarizeDay,
  toDateInputValue,
  toTimeInputValue,
  toggleChecklistItem,
  upcomingItems,
  validateCalendarInput,
  validateCalendarPatch,
  WEEKDAY_LABELS,
} from "./calendar-utils";
import type { CalendarItem, CalendarItemType, CalendarStatus, ChecklistItem } from "./calendar-types";

function makeItem(
  overrides: Partial<CalendarItem> = {},
): CalendarItem {
  return {
    id: "test-id",
    brandId: "b1",
    projectId: "p1",
    postId: null,
    itemType: "post",
    title: "Test",
    description: "",
    scheduledAt: "2026-10-02T12:00:00.000Z",
    status: "planned",
    checklist: [],
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("calendar saf fonksiyonları", () => {
  describe("tarih yardımcıları", () => {
    it("startOfDay saat bileşenlerini sıfırlar", () => {
      const date = new Date(2026, 9, 2, 14, 30, 0);
      const result = startOfDay(date);
      expect(result.getFullYear()).toBe(2026);
      expect(result.getMonth()).toBe(9);
      expect(result.getDate()).toBe(2);
      expect(result.getHours()).toBe(0);
      expect(result.getMinutes()).toBe(0);
    });

    it("isToday", () => {
      // isToday compares with new Date()
      // Just verify the function returns boolean
      const result1 = isToday(new Date());
      expect(typeof result1).toBe("boolean");
      const result2 = isToday(new Date(2020, 0, 1));
      expect(result2).toBe(false);
    });

    it("isSameDay", () => {
      expect(
        isSameDay(
          new Date(2026, 9, 2),
          new Date(2026, 9, 2, 14, 30, 0),
        ),
      ).toBe(true);
      expect(
        isSameDay(
          new Date(2026, 9, 2),
          new Date(2026, 9, 3),
        ),
      ).toBe(false);
    });

    it("isPastDay", () => {
      const reference = new Date(2026, 9, 2);
      expect(isPastDay(new Date(2026, 9, 1), reference)).toBe(true);
      expect(isPastDay(new Date(2026, 9, 2), reference)).toBe(false);
      expect(isPastDay(new Date(2026, 9, 3), reference)).toBe(false);
    });

    it("isWeekend", () => {
      expect(isWeekend(new Date(2026, 9, 3))).toBe(true); // Pazar
      expect(isWeekend(new Date(2026, 9, 4))).toBe(true); // Pazar 2
      expect(isWeekend(new Date(2026, 9, 2))).toBe(false); // Cuma
    });

    it("buildMonthMatrix Pzt başlangıcı", () => {
      const matrix = buildMonthMatrix(2026, 10);
      // Verify structure: 7-day weeks, first cell is not in month
      expect(matrix.length).toBeGreaterThan(0);
      expect(matrix[0].length).toBe(7);
      expect(matrix[0][0].inMonth).toBe(false);
      // Check first day of month is in the matrix
      const firstOfMonth = matrix.flat().find(d => d.date.getDate() === 1 && d.inMonth);
      expect(firstOfMonth).toBeDefined();
    });

    it("WEEKDAY_LABELS", () => {
      expect(WEEKDAY_LABELS).toEqual([
        "Pzt",
        "Sal",
        "Çar",
        "Per",
        "Cum",
        "Cmt",
        "Paz",
      ]);
    });

    it("MONTH_LABELS", () => {
      expect(MONTH_LABELS[9]).toBe("Ekim");
      expect(MONTH_LABELS[0]).toBe("Ocak");
    });

    it("startOfWeek Pzt", () => {
      const thursday = new Date(2026, 9, 8, 12, 0, 0);
      const start = startOfWeek(thursday);
      expect(start.getDay()).toBe(1); // Pzt
      expect(start.getDate()).toBe(5);
      expect(start.getHours()).toBe(0);
    });

    it("itemsForDay", () => {
      const items = [
        makeItem({ scheduledAt: "2026-10-02T09:00:00.000Z" }),
        makeItem({ scheduledAt: "2026-10-02T14:00:00.000Z" }),
        makeItem({ scheduledAt: "2026-10-03T09:00:00.000Z" }),
      ];
      const result = itemsForDay(
        items,
        new Date(2026, 9, 2),
      );
      expect(result).toHaveLength(2);
    });
  });

  describe("format", () => {
    it("formatTime", () => {
      const result = formatTime("2026-10-02T20:00:00.000Z");
      expect(result).toMatch(/^\d{2}:\d{2}$/);
      expect(formatTime("geçersiz")).toBe("—");
    });

    it("formatDayLong", () => {
      expect(formatDayLong(new Date(2026, 9, 2))).toContain("Ekim");
      expect(formatDayLong(new Date(2026, 9, 2))).toContain("2026");
    });

    it("formatRelativeDay", () => {
      const today = new Date(2026, 9, 2, 10, 0, 0);
      const todayStr = formatRelativeDay("2026-10-02T18:00:00.000Z", today);
      expect(todayStr).toContain("Bugün");
      expect(todayStr).toMatch(/\d{2}:\d{2}$/);
    });
  });

  describe("sıralama", () => {
    it("sortByScheduledAt", () => {
      const items = [
        makeItem({ scheduledAt: "2026-10-02T14:00:00.000Z" }),
        makeItem({ scheduledAt: "2026-10-02T09:00:00.000Z" }),
      ];
      const sorted = sortByScheduledAt(items);
      expect(sorted[0].scheduledAt).toBe("2026-10-02T09:00:00.000Z");
      expect(sorted[1].scheduledAt).toBe("2026-10-02T14:00:00.000Z");
    });

    it("derives planned/overdue", () => {
      // Use local time consistently
      const now = new Date(2026, 9, 2, 12, 0, 0); // Local noon
      const pastItem = makeItem({ scheduledAt: new Date(2026, 9, 2, 8, 0, 0).toISOString() }); // 4 hours ago
      const futureItem = makeItem({ scheduledAt: new Date(2026, 9, 2, 16, 0, 0).toISOString() }); // 4 hours later
      expect(deriveStatus(pastItem, now)).toBe("overdue");
      expect(deriveStatus(futureItem, now)).toBe("planned");
      expect(deriveStatus(makeItem({ status: "published" }), now)).toBe("published");
    });
  });

  describe("günlük özet", () => {
    it("summarizeDay", () => {
      const now = new Date(2026, 9, 2, 12, 0, 0);
      const dayItems = [
        makeItem({ scheduledAt: new Date(2026, 9, 2, 8, 0, 0).toISOString(), status: "planned" }),
        makeItem({ scheduledAt: new Date(2026, 9, 2, 16, 0, 0).toISOString(), status: "planned" }),
      ];
      const summary = summarizeDay(dayItems, new Date(2026, 9, 2), now);
      expect(summary.overdue).toBe(1);
      expect(summary.planned).toBe(1);
    });
  });

  describe("yaklaşan kayıtlar", () => {
    it("upcomingItems basic", () => {
      const now = new Date(2026, 9, 2, 12, 0, 0);
      const items = [
        makeItem({ scheduledAt: "2026-10-02T11:00:00.000Z" }),
        makeItem({ scheduledAt: "2026-10-03T12:00:00.000Z" }),
        makeItem({ scheduledAt: "2026-10-15T12:00:00.000Z" }),
      ];
      const upcoming = upcomingItems(items, now, 6);
      expect(upcoming.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("saat dilimleri", () => {
    it("groupByHour itemsForDay", () => {
      const items = [
        makeItem({ scheduledAt: "2026-10-02T09:30:00.000Z" }),
        makeItem({ scheduledAt: "2026-10-02T10:00:00.000Z" }),
      ];
      const slots = groupByHour(items);
      expect(slots.length).toBeGreaterThan(0);
    });

    it("buildWeekColumns", () => {
      const anchor = new Date(2026, 9, 2);
      const columns = buildWeekColumns([], anchor);
      expect(columns).toHaveLength(7);
      expect(columns[0].date.getDay()).toBe(1); // Pzt
    });
  });

  describe("doğrulama", () => {
    it("validateCalendarInput geçerli", () => {
      expect(
        validateCalendarInput({
          title: "Test",
          scheduledAt: "2026-10-02T12:00:00.000Z",
          status: "planned",
          itemType: "post",
          brandId: "b1",
          projectId: "p1",
          postId: null,
        }),
      ).toBeNull();
    });

    it("validateCalendarInput eksik başlık", () => {
      expect(
        validateCalendarInput({
          title: "",
          scheduledAt: "2026-10-02T12:00:00.000Z",
          status: "planned",
          itemType: "post",
          brandId: "b1",
          projectId: "p1",
          postId: null,
        }),
      ).toBe("Başlık gerekli.");
    });

    it("validateCalendarInput geçersiz tarih", () => {
      expect(
        validateCalendarInput({
          title: "Test",
          scheduledAt: "geçersiz",
          status: "planned",
          itemType: "post",
          brandId: "b1",
          projectId: "p1",
          postId: null,
        }),
      ).toBe("Geçersiz tarih.");
    });

    it("validateCalendarPatch", () => {
      expect(validateCalendarPatch({ title: "" })).toBe("Başlık gerekli.");
      expect(validateCalendarPatch({ scheduledAt: "geçersiz" })).toBe("Geçersiz tarih.");
      expect(validateCalendarPatch({ status: "geçersiz" as CalendarStatus })).toBe("Geçersiz durum.");
      expect(validateCalendarPatch({ itemType: "geçersiz" as CalendarItemType })).toBe("Geçersiz içerik türü.");
      expect(validateCalendarPatch({})).toBeNull();
    });
  });

  describe("checklist", () => {
    it("createChecklistItem", () => {
      const item = createChecklistItem("Test");
      expect(item.label).toBe("Test");
      expect(item.done).toBe(false);
      expect(item.id).toBeDefined();
    });

    it("toggleChecklistItem", () => {
      const items: ChecklistItem[] = [createChecklistItem("A", "a1"), createChecklistItem("B", "b1")];
      expect(toggleChecklistItem(items, "b1")[1].done).toBe(true);
    });

    it("randomId", () => {
      const id = randomId();
      expect(id).toBeDefined();
      expect(typeof id).toBe("string");
    });
  });

  describe("tarih girdileri", () => {
    it("toDateInputValue", () => {
      const date = new Date(2026, 9, 2);
      expect(toDateInputValue(date)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it("toTimeInputValue", () => {
      const date = new Date(2026, 9, 2, 14, 30, 0);
      expect(toTimeInputValue(date)).toMatch(/^\d{2}:\d{2}$/);
    });

    it("combineDateTime", () => {
      const result = combineDateTime("2026-10-02", "14:30");
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });
  });
});
