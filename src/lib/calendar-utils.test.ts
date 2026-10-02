import { describe, expect, it } from "vitest";

import {
  buildMonthMatrix,
  combineDateTime,
  computeDraggedScheduledAt,
  createChecklistItem,
  deriveStatus,
  filterByProject,
  formatReminderOffset,
  formatRelativeDay,
  groupByHour,
  isPastDay,
  isSameDay,
  isToday,
  isWeekend,
  itemsForDay,
  startOfWeek,
  summarizeDay,
  toDateInputValue,
  toTimeInputValue,
  toggleChecklistItem,
  upcomingItems,
  validateCalendarInput,
  validateCalendarPatch,
  WEEKDAY_LABELS,
  MONTH_LABELS,
} from "./calendar-utils";
import type {
  CalendarItem,
  CalendarStatus,
} from "./calendar-types";

function item(
  id: string,
  scheduledAt: string,
  overrides: Partial<CalendarItem> = {},
): CalendarItem {
  return {
    id,
    brandId: "brand-a",
    projectId: "proj-1",
    postId: null,
    itemType: "note",
    title: id,
    description: "",
    scheduledAt,
    status: "planned",
    reminderOffsetMinutes: null,
    checklist: [],
    createdAt: "2026-10-01T10:00:00.000Z",
    updatedAt: "2026-10-01T10:00:00.000Z",
    ...overrides,
  };
}

describe("buildMonthMatrix", () => {
  it("Pzt ile başlayan 7 günlük satırlar üretir", () => {
    // 2026-10: 1 Perşembe → ilk hücre 28 Eyl (Pzt).
    const matrix = buildMonthMatrix(2026, 10);
    expect(matrix.length).toBe(5);
    for (const week of matrix) expect(week).toHaveLength(7);
    const first = matrix[0][0];
    expect(first.date.getDate()).toBe(28);
    expect(first.date.getMonth()).toBe(8); // Eylül
    expect(first.inMonth).toBe(false);
    // 1 Ekim Perşembe, aya ait.
    const octFirst = matrix[0][3];
    expect(octFirst.date.getDate()).toBe(1);
    expect(octFirst.inMonth).toBe(true);
  });

  it("son hafta 26–31 Ekim'i aya ait işaretler", () => {
    const matrix = buildMonthMatrix(2026, 10);
    const lastWeek = matrix[matrix.length - 1];
    const inMonth = lastWeek.filter((cell) => cell.inMonth);
    expect(inMonth).toHaveLength(6);
    expect(inMonth[0].date.getDate()).toBe(26);
    expect(inMonth[5].date.getDate()).toBe(31);
  });
});

describe("gün/ay yardımcıları", () => {
  it("isSameDay / isToday / isWeekend", () => {
    const a = new Date(2026, 9, 15, 10);
    const b = new Date(2026, 9, 15, 23);
    expect(isSameDay(a, b)).toBe(true);
    expect(isToday(a, new Date(2026, 9, 15))).toBe(true);
    expect(isToday(a, new Date(2026, 9, 16))).toBe(false);
    expect(isWeekend(new Date(2026, 9, 17))).toBe(true); // Cumartesi
    expect(isWeekend(new Date(2026, 9, 15))).toBe(false); // Perşembe
  });

  it("isPastDay bugün hariç tutar", () => {
    const now = new Date(2026, 9, 15, 12);
    expect(isPastDay(new Date(2026, 9, 15), now)).toBe(false);
    expect(isPastDay(new Date(2026, 9, 14), now)).toBe(true);
    expect(isPastDay(new Date(2026, 9, 16), now)).toBe(false);
  });

  it("startOfWeek Pzt döner", () => {
    const thursday = new Date(2026, 9, 15);
    const start = startOfWeek(thursday);
    expect(start.getDate()).toBe(12);
    expect(start.getDay()).toBe(1);
  });

  it("etiketler Türkçe ve Pzt-first", () => {
    expect(WEEKDAY_LABELS).toEqual([
      "Pzt",
      "Sal",
      "Çar",
      "Per",
      "Cum",
      "Cmt",
      "Paz",
    ]);
    expect(MONTH_LABELS[9]).toBe("Ekim");
  });
});

describe("deriveStatus", () => {
  it("planlanmış geçmiş kayıt overdue türetir; ana durum değişmez", () => {
    const past = item("x", "2026-10-01T10:00:00.000Z");
    expect(
      deriveStatus(past, new Date("2026-10-02T00:00:00.000Z")),
    ).toBe("overdue");
    expect(past.status).toBe("planned");
  });

  it("gelecek planlanmış kayıt planned kalır", () => {
    const future = item("x", "2026-12-01T10:00:00.000Z");
    expect(
      deriveStatus(future, new Date("2026-10-02T00:00:00.000Z")),
    ).toBe("planned");
  });

  it("diğer durumlar aynen döner", () => {
    const published = item("x", "2020-01-01T00:00:00.000Z", {
      status: "published",
    });
    expect(
      deriveStatus(published, new Date("2026-10-02T00:00:00.000Z")),
    ).toBe("published");
  });
});

describe("izolasyon ve sıralama", () => {
  it("filterByProject marka + projeyi birlikte filtreler", () => {
    const items = [
      item("a", "2026-10-01T10:00:00.000Z"),
      item("b", "2026-10-02T10:00:00.000Z", { projectId: "proj-2" }),
      item("c", "2026-10-03T10:00:00.000Z", { brandId: "brand-b" }),
    ];
    expect(filterByProject(items, "brand-a", "proj-1").map((i) => i.id)).toEqual(
      ["a"],
    );
  });

  it("itemsForDay aynı günküleri saat sırasıyla döner", () => {
    const items = [
      item("late", "2026-10-15T20:00:00.000Z"),
      item("early", "2026-10-15T09:00:00.000Z"),
      item("other-day", "2026-10-16T09:00:00.000Z"),
    ];
    const day = itemsForDay(items, new Date(2026, 9, 15));
    expect(day.map((i) => i.id)).toEqual(["early", "late"]);
  });

  it("sortByScheduledAt aynı saatte createdAt'e bakar", () => {
    const second = item("b", "2026-10-15T09:00:00.000Z", {
      createdAt: "2026-10-01T11:00:00.000Z",
    });
    const first = item("a", "2026-10-15T09:00:00.000Z", {
      createdAt: "2026-10-01T10:00:00.000Z",
    });
    expect(itemsForDay([second, first], new Date(2026, 9, 15)).map((i) => i.id)).toEqual([
      "a",
      "b",
    ]);
  });
});

describe("groupByHour", () => {
  it("saat dilimlerine yerleştirir; 08–23 dışı görmezden gelir", () => {
    // Yerel saat dilimi baz alınır (takvim görünümü yereldir).
    const items = [
      item("h9", new Date(2026, 9, 15, 9, 30).toISOString()),
      item("h7", new Date(2026, 9, 15, 7, 30).toISOString()),
      item("h20", new Date(2026, 9, 15, 20, 15).toISOString()),
    ];
    const slots = groupByHour(items);
    expect(slots).toHaveLength(16); // 08..23
    expect(slots[1].hour).toBe(9);
    expect(slots[1].items.map((i) => i.id)).toEqual(["h9"]);
    expect(slots[12].hour).toBe(20);
    expect(slots[12].items.map((i) => i.id)).toEqual(["h20"]);
    expect(slots.every((slot) => !slot.items.some((i) => i.id === "h7"))).toBe(
      true,
    );
  });
});

describe("sürükle-bırak hesabı (§21)", () => {
  // Yerel saatle kurulan kaynak zaman (takvim yereldir).
  const source = () =>
    item("x", new Date(2026, 9, 10, 14, 30).toISOString());

  it("ay görünümü: gün değişir saat korunur", () => {
    const next = computeDraggedScheduledAt(source(), {
      date: new Date(2026, 9, 20),
    });
    const result = new Date(next);
    expect(result.getDate()).toBe(20);
    expect(result.getHours()).toBe(14);
    expect(result.getMinutes()).toBe(30);
  });

  it("hafta/gün görünümü: saat değişir dakika korunur", () => {
    const next = computeDraggedScheduledAt(source(), { hour: 9 });
    const result = new Date(next);
    expect(result.getHours()).toBe(9);
    expect(result.getMinutes()).toBe(30);
  });

  it("geçersiz saat reddedilir", () => {
    const next = computeDraggedScheduledAt(source(), { hour: 99 });
    expect(new Date(next).getHours()).toBe(14);
  });
});

describe("doğrulama (§38)", () => {
  const base = {
    title: "Reel",
    scheduledAt: "2026-10-15T10:00:00.000Z",
    status: "planned" as CalendarStatus,
    itemType: "reel" as const,
    reminderOffsetMinutes: 15,
    brandId: "brand-a",
    projectId: "proj-1",
    postId: null,
  };

  it("geçerli girdi null döner", () => {
    expect(validateCalendarInput(base)).toBeNull();
  });

  it("eksik başlık/marka/proje reddedilir", () => {
    expect(validateCalendarInput({ ...base, title: "  " })).toBe(
      "Başlık gerekli.",
    );
    expect(validateCalendarInput({ ...base, brandId: "" })).toBe(
      "Marka bilgisi eksik.",
    );
    expect(validateCalendarInput({ ...base, projectId: "" })).toBe(
      "Aylık plan bilgisi eksik.",
    );
  });

  it("geçersiz tarih/durum/tür/ön süre reddedilir", () => {
    expect(validateCalendarInput({ ...base, scheduledAt: "yok" })).toBe(
      "Geçersiz tarih.",
    );
    expect(
      validateCalendarInput({ ...base, status: "overdue" as CalendarStatus }),
    ).toBe("Geçersiz durum.");
    expect(
      validateCalendarInput({ ...base, itemType: "carousel" as "post" }),
    ).toBe("Geçersiz içerik türü.");
    expect(validateCalendarInput({ ...base, reminderOffsetMinutes: -5 })).toBe(
      "Geçersiz hatırlatma süresi.",
    );
  });

  it("patch doğrulaması kısmi çalışır", () => {
    expect(validateCalendarPatch({ title: "" })).toBe("Başlık gerekli.");
    expect(validateCalendarPatch({ scheduledAt: "x" })).toBe("Geçersiz tarih.");
    expect(validateCalendarPatch({ status: "bogus" as CalendarStatus })).toBe(
      "Geçersiz durum.",
    );
    expect(validateCalendarPatch({ reminderOffsetMinutes: 60 })).toBeNull();
    expect(validateCalendarPatch({})).toBeNull();
  });
});

describe("checklist (§20)", () => {
  it("oluşturur ve açma/kapama yapar", () => {
    const a = createChecklistItem("  Görsel onayı  ", "c1");
    expect(a).toEqual({ id: "c1", label: "Görsel onayı", done: false });
    const toggled = toggleChecklistItem([a], "c1");
    expect(toggled[0].done).toBe(true);
    // Diğer öğeye dokunmaz.
    const b = createChecklistItem("Diğer", "c2");
    const both = toggleChecklistItem([a, b], "c1");
    expect(both[1].done).toBe(false);
    expect(toggleChecklistItem([a], "nope")).toEqual([a]);
  });
});

describe("biçimlendirme", () => {
  it("reminder offset etiketi", () => {
    expect(formatReminderOffset(15)).toBe("15 dakika önce");
    expect(formatReminderOffset(120)).toBe("2 saat önce");
    expect(formatReminderOffset(2880)).toBe("2 gün önce");
  });

  it("görece gün metni", () => {
    const now = new Date(2026, 9, 15, 12);
    expect(formatRelativeDay("2026-10-15T18:00:00.000Z", now)).toContain(
      "Bugün",
    );
    expect(formatRelativeDay("2026-10-16T18:00:00.000Z", now)).toContain(
      "Yarın",
    );
    expect(formatRelativeDay("2026-10-19T18:00:00.000Z", now)).toContain(
      "Pazartesi",
    );
  });

  it("date/time input değerleri", () => {
    const date = new Date(2026, 9, 5, 9, 5);
    expect(toDateInputValue(date)).toBe("2026-10-05");
    expect(toTimeInputValue(date)).toBe("09:05");
  });

  it("combineDateTime yerel tarihten ISO üretir", () => {
    const iso = combineDateTime("2026-10-15", "14:30");
    const date = new Date(iso);
    expect(date.getFullYear()).toBe(2026);
    expect(date.getMonth()).toBe(9);
    expect(date.getDate()).toBe(15);
    expect(date.getHours()).toBe(14);
    expect(date.getMinutes()).toBe(30);
  });
});

describe("özetler (§31/§32)", () => {
  const now = new Date(2026, 9, 15, 12);

  it("summarizeDay türetilmiş durumları sayar", () => {
    const items = [
      item("p1", "2026-10-15T10:00:00.000Z"),
      item("p2", "2026-10-15T11:00:00.000Z"),
      item("pub", "2026-10-15T09:00:00.000Z", { status: "published" }),
      item("dr", "2026-10-15T08:30:00.000Z", { status: "draft" }),
      item("cx", "2026-10-15T08:00:00.000Z", { status: "cancelled" }),
      item("od", "2026-10-14T10:00:00.000Z"), // başka gün
    ];
    const summary = summarizeDay(items, now, now);
    expect(summary).toEqual({
      total: 5,
      planned: 2,
      published: 1,
      overdue: 0,
      draft: 1,
      cancelled: 1,
    });
  });

  it("geçmiş planlanmış kayıt overdue sayılır", () => {
    const items = [item("od", "2026-10-15T08:00:00.000Z")];
    const summary = summarizeDay(items, now, now);
    expect(summary.overdue).toBe(1);
    expect(summary.planned).toBe(0);
  });

  it("upcomingItems iptalleri atlar, 7 günlük ufğu kesar", () => {
    const items = [
      item("next", "2026-10-15T13:00:00.000Z"),
      item("weekend", "2026-10-20T13:00:00.000Z"),
      item("far", "2026-10-30T13:00:00.000Z"),
      item("past", "2026-10-14T13:00:00.000Z"),
      item("cx", "2026-10-16T13:00:00.000Z", { status: "cancelled" }),
    ];
    const upcoming = upcomingItems(items, now);
    expect(upcoming.map((i) => i.id)).toEqual(["next", "weekend"]);
  });

  it("upcomingItems limit uygular", () => {
    const items = Array.from({ length: 10 }, (_, index) =>
      item(`n${index}`, `2026-10-16T${8 + index}:00:00.000Z`),
    );
    expect(upcomingItems(items, now, 3)).toHaveLength(3);
  });
});
