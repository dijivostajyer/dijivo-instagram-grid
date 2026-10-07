import { describe, expect, it } from "vitest";

import {
  CLIENT_LATE_WINDOW_MS,
  deliveryKey,
  isSourceOfTruth,
  selectCalendarBackend,
  selectDueReminders,
} from "./calendar-backend";
import type { CalendarItem } from "./calendar-types";

const NOW = Date.parse("2026-10-02T12:00:00.000Z");

function item(overrides: Partial<CalendarItem> = {}): CalendarItem {
  return {
    id: "i1",
    brandId: "b1",
    projectId: "p1",
    postId: null,
    itemType: "post",
    title: "Reel",
    description: "",
    scheduledAt: "2026-10-02T13:00:00.000Z",
    status: "planned",
    reminderOffsetMinutes: 60,
    checklist: [],
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("backend seçimi (source of truth)", () => {
  it("yapılandırılmış ve erişilebilir ise Supabase üretim kaynağıdır", () => {
    expect(selectCalendarBackend({ configured: true, reachable: true })).toBe("supabase");
    expect(isSourceOfTruth(selectCalendarBackend({ configured: true, reachable: true }))).toBe(true);
  });

  it("migration uygulanmamışsa local fallback'e düşer", () => {
    expect(selectCalendarBackend({ configured: true, reachable: false })).toBe("local");
    expect(isSourceOfTruth("local")).toBe(false);
  });

  it("yapılandırılmamışsa local fallback'e düşer", () => {
    expect(selectCalendarBackend({ configured: false, reachable: true })).toBe("local");
    expect(selectCalendarBackend({ configured: false, reachable: false })).toBe("local");
  });
});

describe("vadesi gelmiş hatırlatma (istemci yedeği)", () => {
  it("hatırlatması geçmişe düşen kaydı listeler", () => {
    const due = selectDueReminders([item()], [], NOW, "b1");
    expect(due).toEqual([
      { itemId: "i1", remindAt: "2026-10-02T12:00:00.000Z", title: "Reel", itemType: "post" },
    ]);
  });

  it("gelecekteki hatırlatmayı listelemez", () => {
    expect(selectDueReminders([item({ reminderOffsetMinutes: null })], [], NOW, "b1")).toEqual([]);
    const far = item({ scheduledAt: "2026-10-03T13:00:00.000Z", reminderOffsetMinutes: 60 });
    expect(selectDueReminders([far], [], NOW, "b1")).toEqual([]);
  });

  it("geç yakalama penceresinin dışındakileri atlar", () => {
    const old = item({
      scheduledAt: new Date(NOW - CLIENT_LATE_WINDOW_MS - 60_000).toISOString(),
      reminderOffsetMinutes: 0,
    });
    expect(selectDueReminders([old], [], NOW, "b1")).toEqual([]);
  });

  it("başka markanın kayıtlarını listelemez", () => {
    expect(selectDueReminders([item({ brandId: "other" })], [], NOW, "b1")).toEqual([]);
  });

  it("iptal edilmiş kaydı listelemez", () => {
    expect(selectDueReminders([item({ status: "cancelled" })], [], NOW, "b1")).toEqual([]);
  });

  it("geçersiz tarihli kaydı atlar", () => {
    expect(selectDueReminders([item({ scheduledAt: "gecersiz" })], [], NOW, "b1")).toEqual([]);
  });
});

describe("hatırlatma idempotency", () => {
  it("aynı hatırlatma iki kez listelenmez", () => {
    const first = selectDueReminders([item()], [], NOW, "b1");
    expect(first).toHaveLength(1);
    const second = selectDueReminders(
      [item()],
      first.map((entry) => deliveryKey(entry.itemId, entry.remindAt)),
      NOW,
      "b1",
    );
    expect(second).toEqual([]);
  });

  it("backend teslimatı varsa istemci yeniden göndermez", () => {
    const key = deliveryKey("i1", "2026-10-02T12:00:00.000Z");
    expect(selectDueReminders([item()], [key], NOW, "b1")).toEqual([]);
  });

  it("farklı hatırlatma zamanı yeni teslim sayılır", () => {
    // Aynı kayıt, daha erken bir hatırlatma zamanıyla: farklı teslim.
    const earlier = item({ scheduledAt: "2026-10-02T12:30:00.000Z", reminderOffsetMinutes: 60 });
    const key = deliveryKey("i1", "2026-10-02T11:00:00.000Z");
    const due = selectDueReminders([earlier], [key], NOW, "b1");
    expect(due).toHaveLength(1);
    expect(due[0].remindAt).toBe("2026-10-02T11:30:00.000Z");
  });

  it("istemci ve backend aynı anahtar biçimini kullanır", () => {
    expect(deliveryKey("abc", "2026-10-02T12:00:00.000Z")).toBe(
      "abc|2026-10-02T12:00:00.000Z",
    );
  });
});