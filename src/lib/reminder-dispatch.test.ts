import { describe, expect, it } from "vitest";

import { readFileSync } from "node:fs";
import path from "node:path";

import {
  REMINDER_CHANNELS,
  dispatchDueRemindersRpc,
  isGonePushEndpoint,
  isReminderChannel,
  normalizePushSubscription,
  notificationTargetUrl,
  safeNotificationTarget,
  shouldAttemptChannel,
  toDeliveryView,
  type ReminderDeliveryRow,
} from "./reminder-dispatch";

/**
 * Arka plan teslimatının SQL kaynağı migration dosyasıdır
 * (`dispatch_due_reminders()`); bu testler o metni doğrudan okuyup
 * idempotency sözleşmesini doğrular.
 */
const calendarMigrationSql = readFileSync(
  path.resolve(
    __dirname,
    "../../supabase/migrations/202610020003_create_calendar_tables.sql",
  ),
  "utf8",
);
const channelMigrationSql = readFileSync(
  path.resolve(
    __dirname,
    "../../supabase/migrations/202610070006_reminder_delivery_channels.sql",
  ),
  "utf8",
);

/** Migration içindeki dispatch_due_reminders() fonksiyon gövdesi. */
const dispatchFnSql = calendarMigrationSql.slice(
  calendarMigrationSql.indexOf("function public.dispatch_due_reminders"),
  calendarMigrationSql.indexOf("revoke execute on function public.dispatch_due_reminders"),
);

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

describe("teslimat kanal eşsizliği", () => {
  it("aynı reminder için uygulama içi ve browser push satırlarını ayırır", () => {
    expect(channelMigrationSql).toContain("drop constraint if exists reminder_deliveries_once");
    expect(channelMigrationSql).toContain("unique (item_id, remind_at, channel)");
  });
});

describe("vadesi gelmiş hatırlatma RPC'si (arka plan işçisi)", () => {
  it("PostgREST RPC sözleşmesi: rpc/dispatch_due_reminders + p_limit 200", () => {
    expect(dispatchDueRemindersRpc.path).toBe("rpc/dispatch_due_reminders");
    expect(JSON.parse(dispatchDueRemindersRpc.body)).toEqual({ p_limit: 200 });
  });

  it("SQL kaynağı migration'dadır: create or replace + returns setof", () => {
    expect(calendarMigrationSql).toContain(
      "create or replace function public.dispatch_due_reminders(",
    );
    expect(dispatchFnSql).toContain("returns setof public.reminder_deliveries");
  });

  it("remind_at <= now() koşulunu içerir", () => {
    expect(dispatchFnSql).toContain("i.remind_at <= now()");
  });

  it("hatırlatması olmayan kayıtları dışlar", () => {
    expect(dispatchFnSql).toContain("i.remind_at is not null");
  });

  it("iptal edilmiş kayıtları göndermez", () => {
    expect(dispatchFnSql).toContain("i.status <> 'cancelled'");
  });

  it("on conflict do nothing ile idempotenttir (aynı hatırlatma iki kez gitmez)", () => {
    expect(dispatchFnSql).toContain(
      "on conflict (item_id, remind_at) do nothing",
    );
  });

  it("not exists alt sorgusu ile zaten teslim edilmişleri atlar", () => {
    expect(dispatchFnSql).toContain("not exists");
    expect(dispatchFnSql).toContain("d.item_id = i.id");
    expect(dispatchFnSql).toContain("d.remind_at = i.remind_at");
  });

  it("YALNIZCA bu çağrıda yeni oluşturulan satırları RETURN QUERY ile döndürür", () => {
    // Kanal cross join'i YOK: unique (item_id, remind_at) kanal içermiyor,
    // ikinci satır her zaman çakışırdı → worker yalnızca browser_push
    // satırı üretir, dönen satırlar = gerçekten yeni claim edilenler.
    expect(dispatchFnSql).toContain("return query");
    expect(dispatchFnSql).toContain("returning *");
    expect(dispatchFnSql).toContain("'browser_push'");
    expect(dispatchFnSql).not.toContain("values ('in_app'), ('browser_push')");
  });

  it("işçi tek seferde sınırlı sayıda kayıt işler (p_limit, varsayılan 200)", () => {
    expect(dispatchFnSql).toContain("p_limit integer default 200");
    expect(dispatchFnSql).toContain("limit p_limit");
  });

  it("teslimat kaydı için marka, başlık ve gövde yazar", () => {
    expect(dispatchFnSql).toContain("i.brand_id");
    expect(dispatchFnSql).toContain("i.title");
    expect(dispatchFnSql).toContain("Görev hatırlatması");
  });

  it("yalnızca service_role çağırabilir (anon/authenticated kapalı)", () => {
    expect(calendarMigrationSql).toContain(
      "revoke execute on function public.dispatch_due_reminders(integer)",
    );
    expect(calendarMigrationSql).toContain(
      "grant execute on function public.dispatch_due_reminders(integer)",
    );
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
