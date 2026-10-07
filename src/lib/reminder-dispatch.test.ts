import { describe, expect, it } from "vitest";

import {
  REMINDER_CHANNELS,
  dueReminderInsertSql,
  isGonePushEndpoint,
  isReminderChannel,
  normalizePushSubscription,
  notificationTargetUrl,
  safeNotificationTarget,
  shouldAttemptChannel,
  toDeliveryView,
  type ReminderDeliveryRow,
} from "./reminder-dispatch";

function row(overrides: Partial<ReminderDeliveryRow> = {}): ReminderDeliveryRow {
  return {
    id: "d1",
    item_id: "i1",
    brand_id: "b1",
    channel: "in_app",
    remind_at: "2026-10-02T10:00:00.000Z",
    scheduled_at: "2026-10-02T11:00:00.000Z",
    title: "Reel",
    body: "Reel hatırlatması",
    read_at: null,
    ...overrides,
  };
}

describe("kanal mimarisi (in_app / browser_push / email)", () => {
  it("üç kanalı tanır ve yalnızca bunları kabul eder", () => {
    expect(REMINDER_CHANNELS).toEqual(["in_app", "browser_push", "email"]);
    expect(isReminderChannel("in_app")).toBe(true);
    expect(isReminderChannel("browser_push")).toBe(true);
    expect(isReminderChannel("email")).toBe(true);
    expect(isReminderChannel("sms")).toBe(false);
    expect(isReminderChannel(42)).toBe(false);
  });

  it("in_app her zaman denenir, push abonelik varsa, email transport varsa", () => {
    expect(shouldAttemptChannel("in_app", false, false)).toBe(true);
    expect(shouldAttemptChannel("browser_push", true, false)).toBe(true);
    expect(shouldAttemptChannel("browser_push", false, false)).toBe(false);
    expect(shouldAttemptChannel("email", true, false)).toBe(false);
    expect(shouldAttemptChannel("email", true, true)).toBe(true);
  });
});

describe("vadesi gelmiş hatırlatma sorgusu (arka plan işçisi)", () => {
  it("remind_at <= now() koşulunu içerir", () => {
    expect(dueReminderInsertSql).toContain("i.remind_at <= now()");
  });

  it("hatırlatması olmayan kayıtları dışlar", () => {
    expect(dueReminderInsertSql).toContain("i.remind_at is not null");
  });

  it("iptal edilmiş kayıtları göndermez", () => {
    expect(dueReminderInsertSql).toContain("i.status <> 'cancelled'");
  });

  it("on conflict do nothing ile idempotenttir (aynı hatırlatma iki kez gitmez)", () => {
    expect(dueReminderInsertSql).toContain(
      "on conflict (item_id, remind_at) do nothing",
    );
  });

  it("not exists alt sorgusu ile zaten teslim edilmişleri atlar", () => {
    expect(dueReminderInsertSql).toContain("not exists");
    expect(dueReminderInsertSql).toContain("d.item_id = i.id");
    expect(dueReminderInsertSql).toContain("d.remind_at = i.remind_at");
  });

  it("in_app ve browser_push kanallarını üretir", () => {
    expect(dueReminderInsertSql).toContain("('in_app'), ('browser_push')");
  });

  it("işçi tek seferde sınırlı sayıda kayıt işler", () => {
    expect(dueReminderInsertSql).toContain("limit 200");
  });

  it("teslimat kaydı için brand, başlık ve gövde yazar", () => {
    expect(dueReminderInsertSql).toContain("i.brand_id");
    expect(dueReminderInsertSql).toContain("i.title");
    expect(dueReminderInsertSql).toContain("Görev hatırlatması");
  });
});

describe("teslimat görünümü", () => {
  it("snake_case satırı istemci biçimine çevirir", () => {
    expect(toDeliveryView(row())).toEqual({
      id: "d1",
      itemId: "i1",
      brandId: "b1",
      channel: "in_app",
      remindAt: "2026-10-02T10:00:00.000Z",
      scheduledAt: "2026-10-02T11:00:00.000Z",
      title: "Reel",
      body: "Reel hatırlatması",
      readAt: null,
    });
  });

  it("okunmuş teslimatı korur", () => {
    expect(toDeliveryView(row({ read_at: "2026-10-02T12:00:00.000Z" })).readAt).toBe(
      "2026-10-02T12:00:00.000Z",
    );
  });
});

describe("push aboneliği doğrulama", () => {
  const valid = {
    endpoint: "https://fcm.googleapis.com/fcm/send/abc123",
    keys: { p256dh: "BPkyn", auth: "Abc" },
  };

  it("geçerli aboneliği kabul eder", () => {
    const result = normalizePushSubscription(valid, "UA/1.0");
    expect(result).toEqual({
      endpoint: valid.endpoint,
      p256dh: "BPkyn",
      auth: "Abc",
      userAgent: "UA/1.0",
    });
  });

  it("https olmayan uçları reddeder", () => {
    expect(
      normalizePushSubscription({ ...valid, endpoint: "http://push.example.com/x" }),
    ).toBeNull();
    expect(
      normalizePushSubscription({ ...valid, endpoint: "javascript:alert(1)" }),
    ).toBeNull();
  });

  it("eksik anahtarları reddeder", () => {
    expect(normalizePushSubscription({ endpoint: valid.endpoint })).toBeNull();
    expect(
      normalizePushSubscription({ endpoint: valid.endpoint, keys: {} }),
    ).toBeNull();
    expect(
      normalizePushSubscription({
        endpoint: valid.endpoint,
        keys: { p256dh: "BPkyn" },
      }),
    ).toBeNull();
  });

  it("boş/çok uzun endpoint ve anahtarları reddeder", () => {
    expect(normalizePushSubscription({ ...valid, endpoint: "   " })).toBeNull();
    expect(
      normalizePushSubscription({
        ...valid,
        endpoint: `https://push.example.com/${"a".repeat(3000)}`,
      }),
    ).toBeNull();
    expect(
      normalizePushSubscription({
        ...valid,
        keys: { p256dh: "a".repeat(600), auth: "Abc" },
      }),
    ).toBeNull();
  });

  it("string olmayan gövdeleri reddeder", () => {
    expect(normalizePushSubscription(null)).toBeNull();
    expect(normalizePushSubscription("endpoint")).toBeNull();
    expect(normalizePushSubscription([])).toBeNull();
  });

  it("baştaki/sondaki boşlukları temizler", () => {
    expect(
      normalizePushSubscription({
        endpoint: "  https://push.example.com/x  ",
        keys: { p256dh: " BPkyn ", auth: " Abc " },
      })?.p256dh,
    ).toBe("BPkyn");
  });

  it("ölü abonelik durumlarını tanır (404/410)", () => {
    expect(isGonePushEndpoint(404)).toBe(true);
    expect(isGonePushEndpoint(410)).toBe(true);
    expect(isGonePushEndpoint(500)).toBe(false);
    expect(isGonePushEndpoint(429)).toBe(false);
  });
});

describe("bildirim tıklama hedefi", () => {
  it("takvim görünümüne marka + tarih + kayıt bağlamıyla gider", () => {
    expect(
      notificationTargetUrl({
        brandId: "brand-1",
        itemId: "item-9",
        date: "2026-10-16T15:30:00.000Z",
      }),
    ).toBe(
      "/?view=calendar&brand=brand-1&date=2026-10-16T15%3A30%3A00.000Z&item=item-9",
    );
  });

  it("alan yoksa yalnızca takvim görünümüne gider", () => {
    expect(notificationTargetUrl({})).toBe("/?view=calendar");
  });

  it("string olmayan payload'dan güvenli hedef üretir", () => {
    expect(safeNotificationTarget(null)).toBe("/?view=calendar");
    expect(safeNotificationTarget({ brandId: 12, itemId: {} })).toBe(
      "/?view=calendar",
    );
    expect(safeNotificationTarget({ brandId: "b1" })).toBe(
      "/?view=calendar&brand=b1",
    );
  });
});