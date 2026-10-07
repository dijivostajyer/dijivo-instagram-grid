/**
 * reminder-dispatch — arka plan hatırlatma işçisi.
 *
 * Tarayıcı/sekme kapalıyken çalışır. `supabase/functions/reminder-dispatch`
 * olarak deploy edilir ve
 * `supabase/migrations/202610020004_schedule_reminder_dispatch.sql` ile
 * pg_cron üzerinden her dakika tetiklenir.
 *
 * Akış:
 *   1. Vadesi gelmiş hatırlatmaları TEK idempotent ifadeyle teslimat
 *      kaydına çevirir (`on conflict do nothing`).
 *   2. `browser_push` teslimatlarını ilgili markanın aboneliklerine
 *      gönderir (VAPID, `npm:web-push`).
 *   3. 404/410 dönen abonelikleri siler (ölü abonelik temizliği).
 *
 * Aynı SQL `src/lib/reminder-dispatch.ts` içinde `dueReminderInsertSql`
 * olarak tanımlıdır ve birim testleriyle doğrulanır; buradaki sürüm
 * Edge Function ortamı (`src/` içe aktarılamaz) için kopyalanmıştır.
 * İkisi birlikte değiştirilmelidir.
 *
 * GEREKLİ SECRET'LAR (Edge Function secrets — asla commit edilmez):
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (otomatik gelir),
 *   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY
 * `VAPID_PRIVATE_KEY` istemciye ASLA aktarılmaz.
 */

import webpush from "npm:web-push@3.6.7";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY");
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY");

/** `src/lib/reminder-dispatch.ts` ile birebir aynı olmalıdır. */
const DUE_REMINDER_INSERT_SQL = `
insert into public.reminder_deliveries
  (item_id, brand_id, channel, remind_at, scheduled_at, title, body)
select
  i.id,
  i.brand_id,
  v.channel::text,
  i.remind_at,
  i.scheduled_at,
  i.title,
  case i.item_type
    when 'task' then 'Görev hatırlatması'
    when 'note' then 'Not hatırlatması'
    when 'story' then 'Story hatırlatması'
    when 'reel' then 'Reel hatırlatması'
    else 'Post hatırlatması'
  end
from public.calendar_items i
cross join (values ('in_app'), ('browser_push')) as v(channel)
where i.remind_at is not null
  and i.remind_at <= now()
  and i.status <> 'cancelled'
  and not exists (
    select 1
    from public.reminder_deliveries d
    where d.item_id = i.id
      and d.remind_at = i.remind_at
  )
order by i.remind_at
limit 200
on conflict (item_id, remind_at) do nothing
returning id, item_id, brand_id, channel, remind_at, scheduled_at, title, body;
`;

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

Deno.serve(async () => {
  const started = Date.now();

  // 1) Idempotent teslimat kaydı üretimi.
  const insertResponse = await postgrest("reminder_deliveries", {
    method: "POST",
    body: DUE_REMINDER_INSERT_SQL,
  });
  if (!insertResponse.ok) {
    const detail = await insertResponse.text();
    return new Response(
      JSON.stringify({ error: "delivery_insert_failed", detail }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
  const deliveries = (await insertResponse.json()) as DeliveryRow[];

  // 2) Push gönderimi.
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