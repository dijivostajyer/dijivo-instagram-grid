import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  CALENDAR_STORAGE_KEY,
  DELIVERIES_STORAGE_KEY,
  CalendarAccessError,
  LocalCalendarStore,
  type CalendarItemInput,
  type ReminderDeliveryInput,
} from "./calendar-store";

/** Node ortamında localStorage taklidi. */
class MemoryStorage {
  private readonly map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  clear(): void {
    this.map.clear();
  }
}

const storage = new MemoryStorage();

beforeEach(() => {
  storage.clear();
  vi.stubGlobal("window", { localStorage: storage });
});

function input(
  overrides: Partial<CalendarItemInput> = {},
): CalendarItemInput {
  return {
    brandId: "brand-a",
    projectId: "proj-1",
    postId: null,
    itemType: "note",
    title: "Not",
    description: "",
    scheduledAt: "2026-10-15T10:00:00.000Z",
    status: "planned",
    reminderOffsetMinutes: 15,
    checklist: [],
    ...overrides,
  };
}

function delivery(
  overrides: Partial<ReminderDeliveryInput> = {},
): ReminderDeliveryInput {
  return {
    itemId: "item-1",
    brandId: "brand-a",
    channel: "in_app",
    remindAt: "2026-10-15T09:45:00.000Z",
    scheduledAt: "2026-10-15T10:00:00.000Z",
    title: "Not",
    body: "10:00 not planlandı",
    ...overrides,
  };
}

describe("LocalCalendarStore — izolasyon (§23/§24)", () => {
  it("list yalnızca aynı marka + projeyi döner", async () => {
    const store = new LocalCalendarStore();
    await store.create(input());
    await store.create(input({ projectId: "proj-2" }));
    await store.create(input({ brandId: "brand-b" }));
    const items = await store.list("brand-a", "proj-1");
    expect(items).toHaveLength(1);
    expect(items[0].projectId).toBe("proj-1");
  });

  it("listAll markanın tüm projelerini döner", async () => {
    const store = new LocalCalendarStore();
    await store.create(input());
    await store.create(input({ projectId: "proj-2" }));
    await store.create(input({ brandId: "brand-b" }));
    const items = await store.listAll("brand-a");
    expect(items).toHaveLength(2);
  });
});

describe("LocalCalendarStore — CRUD", () => {
  it("create kimlik ve damga atar", async () => {
    const store = new LocalCalendarStore();
    const created = await store.create(input());
    expect(created.id).toBeTruthy();
    expect(created.createdAt).toBe(created.updatedAt);
    const items = await store.list("brand-a", "proj-1");
    expect(items).toHaveLength(1);
  });

  it("update yama birleştirir", async () => {
    // Saati kontrol edilebilir kıl: her çağrıda ilerlesin.
    let tick = 0;
    const now = () =>
      new Date(Date.UTC(2026, 9, 2, 10, 0, 0, tick++));
    const store = new LocalCalendarStore(
      undefined,
      undefined,
      now,
    );
    const created = await store.create(input());
    const updated = await store.update(
      created.id,
      { title: "Güncellendi", status: "published" },
      "brand-a",
    );
    expect(updated.title).toBe("Güncellendi");
    expect(updated.status).toBe("published");
    // dokunulmayan alan korunur
    expect(updated.reminderOffsetMinutes).toBe(15);
    expect(updated.updatedAt).not.toBe(created.updatedAt);
  });

  it("update checklist sıfırlanabilir", async () => {
    const store = new LocalCalendarStore();
    const created = await store.create(
      input({
        checklist: [{ id: "c1", label: "A", done: false }],
      }),
    );
    const updated = await store.update(
      created.id,
      { checklist: [] },
      "brand-a",
    );
    expect(updated.checklist).toEqual([]);
  });

  it("yabancı marka erişimi reddeder", async () => {
    const store = new LocalCalendarStore();
    const created = await store.create(input());
    await expect(
      store.update(created.id, { title: "x" }, "brand-b"),
    ).rejects.toBeInstanceOf(CalendarAccessError);
    await expect(
      store.remove(created.id, "brand-b"),
    ).rejects.toBeInstanceOf(CalendarAccessError);
  });

  it("olmayan kayıt reddeder", async () => {
    const store = new LocalCalendarStore();
    await expect(
      store.update("yok", { title: "x" }, "brand-a"),
    ).rejects.toBeInstanceOf(CalendarAccessError);
    await expect(store.remove("yok", "brand-a")).rejects.toBeInstanceOf(
      CalendarAccessError,
    );
  });

  it("remove kaskad olarak hatırlatma teslimlerini siler", async () => {
    const store = new LocalCalendarStore();
    const created = await store.create(input());
    await store.deliverReminder(
      delivery({ itemId: created.id }),
    );
    expect(
      (await store.listDeliveries("brand-a")),
    ).toHaveLength(1);
    await store.remove(created.id, "brand-a");
    expect(await store.listDeliveries("brand-a")).toHaveLength(0);
    expect(await store.list("brand-a", "proj-1")).toHaveLength(0);
  });
});

describe("LocalCalendarStore — once-only hatırlatma (§27)", () => {
  it("aynı (itemId, remindAt) ikinci teslimi reddeder", async () => {
    const store = new LocalCalendarStore();
    const first = await store.deliverReminder(delivery());
    expect(first.readAt).toBeNull();
    await expect(store.deliverReminder(delivery())).rejects.toThrow(
      "Hatırlatma zaten teslim edildi.",
    );
    // Farklı zaman ikinci teslime izin verir.
    await store.deliverReminder(
      delivery({ remindAt: "2026-10-15T09:00:00.000Z" }),
    );
    expect(await store.listDeliveries("brand-a")).toHaveLength(2);
  });

  it("teslimimler yeni önce sıralanır", async () => {
    const store = new LocalCalendarStore();
    await store.deliverReminder(
      delivery({ remindAt: "2026-10-15T09:00:00.000Z" }),
    );
    await store.deliverReminder(
      delivery({ remindAt: "2026-10-15T09:45:00.000Z" }),
    );
    const deliveries = await store.listDeliveries("brand-a");
    expect(deliveries[0].remindAt).toBe(
      "2026-10-15T09:45:00.000Z",
    );
  });

  it("teslimimler marka izolasyonundadır", async () => {
    const store = new LocalCalendarStore();
    await store.deliverReminder(delivery());
    await store.deliverReminder(
      delivery({ brandId: "brand-b", itemId: "item-b1" }),
    );
    expect(await store.listDeliveries("brand-a")).toHaveLength(1);
    expect(await store.listDeliveries("brand-b")).toHaveLength(1);
  });
});

describe("LocalCalendarStore — okunma (§29)", () => {
  it("markRead yalnızca kendi markasını işaretler", async () => {
    const store = new LocalCalendarStore();
    const first = await store.deliverReminder(delivery());
    await store.markRead(first.id, "brand-a");
    const deliveries = await store.listDeliveries("brand-a");
    expect(deliveries[0].readAt).not.toBeNull();
    await expect(
      store.markRead(first.id, "brand-b"),
    ).rejects.toBeInstanceOf(CalendarAccessError);
  });

  it("markAllRead yalnızca aktif markayı etkiler", async () => {
    const store = new LocalCalendarStore();
    await store.deliverReminder(delivery());
    await store.deliverReminder(
      delivery({ brandId: "brand-b", itemId: "item-b1" }),
    );
    await store.markAllRead("brand-a");
    const own = await store.listDeliveries("brand-a");
    const other = await store.listDeliveries("brand-b");
    expect(own.every((d) => d.readAt !== null)).toBe(true);
    expect(other.every((d) => d.readAt === null)).toBe(true);
  });

  it("bozuk localStorage JSON'ı boş liste döner", async () => {
    storage.setItem(CALENDAR_STORAGE_KEY, "{yok");
    storage.setItem(DELIVERIES_STORAGE_KEY, "[1,2");
    const store = new LocalCalendarStore();
    expect(await store.list("brand-a", "proj-1")).toEqual([]);
    expect(await store.listDeliveries("brand-a")).toEqual([]);
  });
});
