/**
 * Takvim arka uç seçimi (§ production source of truth).
 *
 * İki kural:
 *
 * 1. **Source of truth.** Supabase yapılandırılmış VE erişilebilir
 *    ise production kaynağı odur; localStorage yalnızca
 *    cache/fallback'tir. Erişilemiyorsa (migration uygulanmamış,
 *    proje askıda, ağ yok) `LocalCalendarStore` kullanılır ve
 *    kullanıcı verisi kaybolmaz.
 *
 * 2. **Vadesi gelmiş hatırlatma.** Backend işçisi
 *    (`supabase/functions/reminder-dispatch`) birincil teslimat
 *    sahibidir. İstemci poll'ü yalnızca **yedek**tir ve backend
 *    teslimatlarıyla çakışmaz: aynı `itemId|remindAt` anahtarı
 *    ikisinde de kullanılır, backend kaydı görüldüğünde
 *    istemci yeniden göndermez.
 */

import type { CalendarItem } from "./calendar-types";

/** Arka uç seçimi. */
export type CalendarBackend = "supabase" | "local";

export interface BackendProbe {
  /** `SUPABASE_URL` ve `SUPABASE_SECRET_KEY` tanımlı mı? */
  configured: boolean;
  /** `calendar_items` tablosu gerçekten okunabildi mi? */
  reachable: boolean;
}

/**
 * Yapılandırılmış **ve** erişilebilir ise Supabase üretim kaynağıdır.
 * Aksi halde local fallback (veri kaybı olmaz).
 */
export function selectCalendarBackend(probe: BackendProbe): CalendarBackend {
  return probe.configured && probe.reachable ? "supabase" : "local";
}

/** Production'da veri tutulması gereken arka uç. */
export function isSourceOfTruth(backend: CalendarBackend): boolean {
  return backend === "supabase";
}

export interface DueReminderCandidate {
  itemId: string;
  remindAt: string;
  title: string;
  itemType: CalendarItem["itemType"];
}

/** İstemci poll'ünün geç yakalama penceresi (backend ile aynı kural). */
export const CLIENT_LATE_WINDOW_MS = 12 * 60 * 60 * 1000;

function remindAtOf(item: CalendarItem): string | null {
  if (item.reminderOffsetMinutes == null) return null;
  const remindAt = new Date(
    new Date(item.scheduledAt).getTime() - item.reminderOffsetMinutes * 60_000,
  );
  return Number.isNaN(remindAt.getTime()) ? null : remindAt.toISOString();
}

/**
 * Vadesi gelmiş hatırlatmaları backend teslimatlarından bağımsız
 * olarak listeler. `alreadyDelivered` anahtarları verilirse (istemci
 * deposundaki teslimatlar) atlanır — backend'in yaptığı teslimat
 * istemci tarafından tekrarlanmaz.
 */
export function selectDueReminders(
  items: CalendarItem[],
  alreadyDelivered: Iterable<string>,
  now: number,
  brandId: string,
): DueReminderCandidate[] {
  const delivered = new Set(alreadyDelivered);
  const due: DueReminderCandidate[] = [];
  for (const item of items) {
    if (item.brandId !== brandId) continue;
    if (item.status === "cancelled") continue;
    const remindAt = remindAtOf(item);
    if (remindAt === null) continue;
    const remindTime = Date.parse(remindAt);
    if (Number.isNaN(remindTime)) continue;
    if (remindTime > now) continue;
    if (remindTime < now - CLIENT_LATE_WINDOW_MS) continue;
    const key = `${item.id}|${remindAt}`;
    if (delivered.has(key)) continue;
    delivered.add(key);
    due.push({
      itemId: item.id,
      remindAt,
      title: item.title,
      itemType: item.itemType,
    });
  }
  return due;
}

/** Teslimat anahtarı — istemci ve backend aynı anahtarı kullanır. */
export function deliveryKey(itemId: string, remindAt: string): string {
  return `${itemId}|${remindAt}`;
}