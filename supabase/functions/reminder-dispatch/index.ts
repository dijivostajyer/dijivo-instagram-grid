/**
 * reminder-dispatch — arka plan hatırlatma işçisi.
 *
 * Tarayıcı/sekme kapalıyken çalışır. `supabase/functions/reminder-dispatch`
 * olarak deploy edilir ve `202610020004_schedule_reminder_dispatch.sql`
 * ile pg_cron + pg_net üzerinden her dakika tetiklenir.
 *
 * Akış:
 *   1. Vadesi gelmiş hatırlatmaları **PostgREST RPC** üzerinden TEK
 *      idempotent çağrıda teslimat kaydına çevirir:
 *        POST /rest/v1/rpc/dispatch_due_reminders  { "p_limit": 200 }
 *      RPC (dispatch_due_reminders), `202610020003_create_calendar_tables.sql`
 *      içinde tanımlıdır: `remind_at <= now() AND not yet delivered`
 *      sorgusunu çalıştırır, `unique (item_id, remind_at)` korumasıyla
 *      `on conflict do nothing` yapar ve YALNIZCA bu çağrıda yeni
 *      oluşturulan satırları RETURN QUERY ile döndürür.
 *
 *      Neden RPC? PostgREST ham SQL çalıştırmaz — `/rest/v1/<tabloya>`
 *      ham SQL body olarak göndermek production'da 400 döner ve teslimat
 *      hiç üretilmez. Ham SQL'in doğru yeri veritabanı fonksiyonudur.
 *
 *   2. Dönen (`browser_push` kanallı) satırları ilgili markanın
 *      aboneliklerine gönderir (VAPID, `npm:web-push`).
 *   3. 404/410 dönen abonelikleri siler (ölü abonelik temizliği).
 *
 * GEREKLİ SECRET'LAR (Edge Function secrets — asla commit edilmez):
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (otomatik gelir),
 *   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY
 * `VAPID_PRIVATE_KEY` istemciye ASLA aktarılmaz.
 *
 * AUTH: function `--no-verify-jwt` ile deploy edilir; cron çağrısı
 * `apikey` header'ıyla gelir (Supabase docs: Securing Edge Functions —
 * service-to-service çağrılar JWT değil apikey taşır). Bu function
 * gelen apikey'i kendi service-role anahtarıyla eşleştirir; eşleşmezse
 * 401 döner. pg_net çağrısındaki header seti
 * `202610020004_schedule_reminder_dispatch.sql` içinde tanımlıdır.
 */

import webpush from "npm:web-push@3.6.7";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY");
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY");

/** RPC adı — 0003 migration'ındaki `dispatch_due_reminders()` ile birebir aynı olmalıdır. */
const DISPATCH_RPC = "rpc/dispatch_due_reminders";
const DISPATCH_RPC_BODY = JSON.stringify({ p_limit: 200 });

interface DeliveryRow {
  id: string;
  item_id: string;
  brand_id: string;
  channel: "in_app" | "browser_push" | "email";
  remind_at: string;
  scheduled_at: string;
  title: string;
  body: string;
}

interface SubscriptionRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

function postgrest(path: string, init: RequestInit): Promise<Response> {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(init.headers ?? {}),
    },
  });
}

function pushConfigured(): boolean {
  return Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);
}

/**
 * Handler-side auth (`--no-verify-jwt` deploy edildiği için platform
 * kontrolü kapalıdır). Cron çağrısı `apikey` header'ıyla service-role
 * anahtarını taşır; `Authorization: Bearer` da desteklenir.
 */
function isAuthorized(request: Request): boolean {
  const presented =
    request.headers.get("apikey") ??
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    "";
  return presented.length > 0 && presented === SERVICE_ROLE_KEY;
}

function jsonError(status: number, error: string, detail?: string): Response {
  return new Response(
    JSON.stringify(detail === undefined ? { error } : { error, detail }),
    { status, headers: { "Content-Type": "application/json" } },
  );
}

Deno.serve(async (request) => {
  if (!isAuthorized(request)) {
    return jsonError(401, "unauthorized");
  }

  const started = Date.now();

  // 1) Idempotent teslimat kaydı — PostgREST RPC (ham SQL DEĞİL).
  const dispatchResponse = await postgrest(DISPATCH_RPC, {
    method: "POST",
    body: DISPATCH_RPC_BODY,
  });
  if (!dispatchResponse.ok) {
    const detail = await dispatchResponse.text();
    return jsonError(500, "dispatch_rpc_failed", detail);
  }
  // RPC SETOF döndürür → doğrudan satır dizisi gelir; yalnızca bu çağrıda
  // yeni eklenen (çakışmayan) satırlar buradadır.
  const deliveries = (await dispatchResponse.json()) as DeliveryRow[];

  // 2) Push gönderimi (dönen satırlar zaten browser_push kanalındadır).
  const pushDeliveries = deliveries.filter((row) => row.channel === "browser_push");
  let pushed = 0;
  let removedSubscriptions = 0;
  let skipped = 0;

  if (pushDeliveries.length > 0) {
    if (!pushConfigured()) {
      skipped = pushDeliveries.length;
    } else {
      webpush.setVapidDetails(
        "mailto:admin@dijivo.example",
        VAPID_PUBLIC_KEY!,
        VAPID_PRIVATE_KEY!,
      );
      const brandIds = [...new Set(pushDeliveries.map((row) => row.brand_id))];
      for (const brandId of brandIds) {
        const subsResponse = await postgrest(
          `push_subscriptions?brand_id=eq.${encodeURIComponent(brandId)}&select=id,endpoint,p256dh,auth`,
          { method: "GET" },
        );
        const subscriptions = subsResponse.ok
          ? ((await subsResponse.json()) as SubscriptionRow[])
          : [];
        const pending = pushDeliveries.filter((row) => row.brand_id === brandId);
        if (subscriptions.length === 0) {
          skipped += pending.length;
          continue;
        }
        for (const row of pending) {
          const payload = JSON.stringify({
            title: `Hatırlatma: ${row.title}`,
            body: row.body,
            tag: `calendar-${row.item_id}`,
            data: {
              brandId: row.brand_id,
              itemId: row.item_id,
              date: row.scheduled_at,
              deliveryId: row.id,
            },
          });
          for (const subscription of subscriptions) {
            try {
              await webpush.sendNotification(
                {
                  endpoint: subscription.endpoint,
                  keys: { p256dh: subscription.p256dh, auth: subscription.auth },
                },
                payload,
              );
              pushed += 1;
            } catch (error) {
              const status = (error as { statusCode?: number }).statusCode;
              // 404/410: abonelik artık geçerli değil → temizle.
              if (status === 404 || status === 410) {
                await postgrest(`push_subscriptions?id=eq.${subscription.id}`, {
                  method: "DELETE",
                });
                removedSubscriptions += 1;
              } else {
                skipped += 1;
              }
            }
          }
        }
      }
    }
  }

  return new Response(
    JSON.stringify({
      ok: true,
      created: deliveries.length,
      pushed,
      skipped,
      removedSubscriptions,
      pushConfigured: pushConfigured(),
      durationMs: Date.now() - started,
    }),
    { headers: { "Content-Type": "application/json" } },
  );
});
