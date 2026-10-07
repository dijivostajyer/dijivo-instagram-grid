/**
 * Arka plan hatırlatma işçisi (§ background notifications).
 *
 * Tarayıcı açıkken 15 saniyelik polling yalnızca "kullanıcı zaten ekrana
 * bakıyorken" çalışır. Gerçek arka plan teslimatı backend'de yapılır:
 * Supabase Edge Function (`supabase/functions/reminder-dispatch`) bu
 * modülün SQL'ini ve şemasını kullanır.
 *
 * Idempotency sözleşmesi:
 *
 *   remind_at <= now()  AND  henüz teslim kaydı yok
 *
 * denklemine karşılık gelen tek SQL ifadesi `dueReminderInsertSql`
 * (`on conflict do nothing` ile). `reminder_deliveries` üzerindeki
 * `unique (item_id, remind_at)` kısıtı yarışta ikinci işçiyi de durdurur.
 */

/** Teslimat kanalları (§ mimari: in_app / browser_push / email). */
export const REMINDER_CHANNELS = ["in_app", "browser_push", "email"] as const;

export type ReminderChannel = (typeof REMINDER_CHANNELS)[number];

export function isReminderChannel(value: unknown): value is ReminderChannel {
  return (
    typeof value === "string" &&
    (REMINDER_CHANNELS as readonly string[]).includes(value)
  );
}

/**
 * `in_app` teslimatı her zaman yapılır; `browser_push` yalnızca abonelik
 * varsa; `email` bu fazda transport uygulanmadığı için atlanır
 * (mimari yerinde durur, kayıt sessizce düşmez).
 */
export function shouldAttemptChannel(
  channel: ReminderChannel,
  hasPushSubscription: boolean,
  emailTransportReady: boolean,
): boolean {
  if (channel === "in_app") return true;
  if (channel === "browser_push") return hasPushSubscription;
  return emailTransportReady;
}

/**
 * Vadesi gelmiş hatırlatmaları tek ve idempotent bir ifadeyle alır.
 *
 * - `due_at = scheduled_at - reminder_offset_minutes`
 * - Teslim kaydı `on conflict do nothing` ile yazılır; çakışan satır
 *   döndürülmez → "zaten gönderilmiş" demektir.
 * - `for update skip locked` eşzamanlı işçi çağrılarını birbirinden
 *   ayırır (cron + elle tetikleme birlikte çalışabilir).
 */
export const dueReminderInsertSql = `
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

/** Bildirim merkezinde gösterilecek teslimatın istemci görünümü. */
export interface ReminderDeliveryRow {
  id: string;
  item_id: string;
  brand_id: string;
  channel: ReminderChannel;
  remind_at: string;
  scheduled_at: string;
  title: string;
  body: string;
  read_at: string | null;
}

/** Bir teslimat satırını istemciye gönderilecek biçime çevirir. */
export function toDeliveryView(row: ReminderDeliveryRow): {
  id: string;
  itemId: string;
  brandId: string;
  channel: ReminderChannel;
  remindAt: string;
  scheduledAt: string;
  title: string;
  body: string;
  readAt: string | null;
} {
  return {
    id: row.id,
    itemId: row.item_id,
    brandId: row.brand_id,
    channel: row.channel,
    remindAt: row.remind_at,
    scheduledAt: row.scheduled_at,
    title: row.title,
    body: row.body,
    readAt: row.read_at,
  };
}

// ---------------------------------------------------------------------------
// Push abonelikleri
// ---------------------------------------------------------------------------

/** Web Push abonelik gövdesi (tarayıcı `PushSubscription.toJSON()` çıktısı). */
export interface PushSubscriptionPayload {
  endpoint: string;
  expirationTime?: number | null;
  keys?: { p256dh?: string; auth?: string };
}

/** Sunucuya kaydedilecek normalize abonelik. */
export interface NormalizedPushSubscription {
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent: string | null;
}

/**
 * Görünmez karakterleri (base64url'da nokta olabilir, ama baş/son
 * boşluk kabul edilmez) ayıklayıp abonelik gövdesini doğrular.
 * Geçersizse `null` döner — istemci hata mesajıyla uyarılır.
 */
export function normalizePushSubscription(
  value: unknown,
  userAgent: string | null = null,
): NormalizedPushSubscription | null {
  if (typeof value !== "object" || value === null) return null;
  const payload = value as Partial<PushSubscriptionPayload>;
  if (typeof payload.endpoint !== "string") return null;
  const endpoint = payload.endpoint.trim();
  if (endpoint.length === 0 || endpoint.length > 2048) return null;
  // Yalnızca push servislerinin ürettiği HTTPS uçları kabul edilir.
  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") return null;
  const keys = payload.keys;
  if (typeof keys !== "object" || keys === null) return null;
  const p256dh = typeof keys.p256dh === "string" ? keys.p256dh.trim() : "";
  const auth = typeof keys.auth === "string" ? keys.auth.trim() : "";
  if (p256dh.length === 0 || auth.length === 0) return null;
  if (p256dh.length > 512 || auth.length > 512) return null;
  return { endpoint, p256dh, auth, userAgent };
}

/** Push hataları: 404/410 → abonelik ölü, sunucudan silinmeli. */
export function isGonePushEndpoint(status: number): boolean {
  return status === 404 || status === 410;
}

// ---------------------------------------------------------------------------
// Bildirim tıklama hedefi (service worker → uygulama)
// ---------------------------------------------------------------------------

/**
 * Bildirim verisinden uygulama içi hedef üretir. Takvim kaydına gider;
 * kayıt yoksa ana ekrana düşer.
 */
export function notificationTargetUrl(input: {
  brandId?: string;
  itemId?: string;
  date?: string;
}): string {
  const params = new URLSearchParams();
  if (input.brandId) params.set("brand", input.brandId);
  if (input.date) params.set("date", input.date);
  if (input.itemId) params.set("item", input.itemId);
  const query = params.toString();
  const base = "/?view=calendar";
  return query.length > 0 ? `${base}&${query}` : base;
}

/** Bildirim verisinden güvenli hedef üretir (alanlar eksikse ana ekran). */
export function safeNotificationTarget(data: unknown): string {
  if (typeof data !== "object" || data === null) return notificationTargetUrl({});
  const record = data as Record<string, unknown>;
  const brandId = typeof record.brandId === "string" ? record.brandId : undefined;
  const itemId = typeof record.itemId === "string" ? record.itemId : undefined;
  const date = typeof record.date === "string" ? record.date : undefined;
  return notificationTargetUrl({ brandId, itemId, date });
}