import type {
  CalendarItem,
  CalendarItemType,
  CalendarStatus,
  ChecklistItem,
  DisplayStatus,
} from "./calendar-types";

/**
 * Takvim modülü saf fonksiyonları — tarayıcı bağımsız,
 * doğrudan test edilir. React durumu burada yaşmaz.
 */

/** Bir güünün başlangıcı (00:00 lokal). */
export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** Ay matrisi: hafta Pzt ile başlar (§4). Her hücre gün + aidiyet. */
export interface CalendarDay {
  date: Date;
  /** Bu hücre aktif aya ait mi? (leading/trailing günler muted) */
  inMonth: boolean;
}

export function buildMonthMatrix(
  year: number,
  month: number,
): CalendarDay[][] {
  const first = new Date(year, month - 1, 1);
  const last = new Date(year, month, 0);
  // JS getDay(): 0=Pazar. Pzt=0 bazına kaydır.
  const startWeekday = (first.getDay() + 6) % 7;
  const firstCell = new Date(year, month - 1, 1 - startWeekday);
  const totalCells = startWeekday + last.getDate();
  const weekCount = Math.ceil(totalCells / 7);
  const weeks: CalendarDay[][] = [];
  const cursor = new Date(firstCell);
  for (let week = 0; week < weekCount; week += 1) {
    const days: CalendarDay[] = [];
    for (let day = 0; day < 7; day += 1) {
      days.push({
        date: new Date(cursor),
        inMonth: cursor.getMonth() === first.getMonth(),
      });
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(days);
  }
  return weeks;
}

/** Kısa gün adları (§4: Pzt Sal Çar Per Cum Cmt Paz). */
export const WEEKDAY_LABELS = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];

export const MONTH_LABELS = [
  "Ocak",
  "Şubat",
  "Mart",
  "Nisan",
  "Mayıs",
  "Haziran",
  "Temmuz",
  "Ağustos",
  "Eylül",
  "Ekim",
  "Kasım",
  "Aralık",
];

export function isSameDay(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

export function isToday(date: Date, now = new Date()): boolean {
  return isSameDay(date, now);
}

/** Geçmiş gün: bugün hariç, bugün başlangıcından önce (§5). */
export function isPastDay(date: Date, now = new Date()): boolean {
  return startOfDay(date).getTime() < startOfDay(now).getTime();
}

export function isWeekend(date: Date): boolean {
  const day = date.getDay();
  return day === 0 || day === 6;
}

/**
 * Türetilmiş durum (§7): planlanandı ama tarihi geçtiyse
 * "overdue". Veritabanındaki ana status değişmez.
 */
export function deriveStatus(
  item: Pick<CalendarItem, "status" | "scheduledAt">,
  now = new Date(),
): DisplayStatus {
  if (item.status !== "planned") return item.status;
  return new Date(item.scheduledAt).getTime() < now.getTime()
    ? "overdue"
    : "planned";
}

/** Günlük planlama: önce saat, sonra oluşturma sırası. */
export function sortByScheduledAt<T extends Pick<CalendarItem, "scheduledAt" | "createdAt">>(
  items: T[],
): T[] {
  return [...items].sort((left, right) => {
    const leftTime = new Date(left.scheduledAt).getTime();
    const rightTime = new Date(right.scheduledAt).getTime();
    if (Number.isFinite(leftTime) && Number.isFinite(rightTime)) {
      if (leftTime !== rightTime) return leftTime - rightTime;
    } else if (Number.isFinite(leftTime)) return -1;
    else if (Number.isFinite(rightTime)) return 1;
    return left.createdAt.localeCompare(right.createdAt);
  });
}

/** Bir güne ait kayıtlar (§10: gün detayı). */
export function itemsForDay(
  items: CalendarItem[],
  date: Date,
): CalendarItem[] {
  return sortByScheduledAt(
    items.filter((item) => isSameDay(new Date(item.scheduledAt), date)),
  );
}

/**
 * Marka + proje izolasyonu (§23/§24): yalnızca aktif
 * marka ve aktif aylık planın kayıtları alınır.
 */
export function filterByProject(
  items: CalendarItem[],
  brandId: string,
  projectId: string,
): CalendarItem[] {
  return items.filter(
    (item) => item.brandId === brandId && item.projectId === projectId,
  );
}

/** Saat biçimi: "20:00". */
export function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleTimeString("tr-TR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** "15 Ekim 2026" biçimi. */
export function formatDayLong(date: Date): string {
  return date.toLocaleDateString("tr-TR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/** "Perşembe" gibi gün adı. */
export function formatWeekdayLong(date: Date): string {
  return date.toLocaleDateString("tr-TR", { weekday: "long" });
}

/** "Bugün 18:00", "Yarın 14:00", "Cuma 11:30" (§32). */
export function formatRelativeDay(iso: string, now = new Date()): string {
  const date = new Date(iso);
  const time = formatTime(iso);
  if (Number.isNaN(date.getTime())) return `— ${time}`;
  const diffDays = Math.round(
    (startOfDay(date).getTime() - startOfDay(now).getTime()) / 86_400_000,
  );
  if (diffDays === 0) return `Bugün ${time}`;
  if (diffDays === 1) return `Yarın ${time}`;
  if (diffDays > 1 && diffDays < 7) {
    return `${date.toLocaleDateString("tr-TR", { weekday: "long" })} ${time}`;
  }
  return `${formatDayLong(date)} ${time}`;
}

/** Günlük görünümdeki saat aralığı (§16: 08:00–23:00). */
export const DAY_VIEW_HOURS = Array.from({ length: 16 }, (_, index) => index + 8);

/** Haftalık/günlük görünümdeki saat dilimi başlangıç/bitiş. */
export const DAY_VIEW_START_HOUR = 8;
export const DAY_VIEW_END_HOUR = 24;

/** Günlük görünüm: günü saat dilimlerine ayırır (§16). */
export interface HourSlot {
  hour: number;
  items: CalendarItem[];
}

export function groupByHour(items: CalendarItem[]): HourSlot[] {
  const slots: HourSlot[] = DAY_VIEW_HOURS.map((hour) => ({ hour, items: [] }));
  for (const item of sortByScheduledAt(items)) {
    const date = new Date(item.scheduledAt);
    const hour = date.getHours();
    if (hour >= DAY_VIEW_START_HOUR && hour < DAY_VIEW_END_HOUR) {
      slots[hour - DAY_VIEW_START_HOUR].items.push(item);
    }
  }
  return slots;
}

/** Haftalık görünüm: 7 günü saat kolonlarına ayırır (§17). */
export interface WeekDayColumn {
  date: Date;
  isToday: boolean;
  isWeekend: boolean;
  slots: HourSlot[];
}

export function buildWeekColumns(
  items: CalendarItem[],
  anchor: Date,
  now = new Date(),
): WeekDayColumn[] {
  const start = new Date(anchor);
  // Pzt başlangıcı.
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return {
      date,
      isToday: isToday(date, now),
      isWeekend: isWeekend(date),
      slots: groupByHour(itemsForDay(items, date)),
    };
  });
}

/** Haftanın başlangıcı (Pzt) — ay/hafta/gün navigasyonu için. */
export function startOfWeek(date: Date): Date {
  const result = new Date(date);
  result.setDate(result.getDate() - ((result.getDay() + 6) % 7));
  return startOfDay(result);
}

/**
 * Yeni kayıt doğrulama (§38). Başarısız nedenini döner;
 * geçerliyse null.
 */
export function validateCalendarInput(input: {
  title: string;
  scheduledAt: string;
  status: CalendarStatus;
  itemType: CalendarItemType;
  brandId: string;
  projectId: string;
  postId: string | null;
  description?: string;
  checklist?: ChecklistItem[];
}): string | null {
  if (!input.brandId.trim()) return "Marka bilgisi eksik.";
  if (!input.projectId.trim()) return "Aylık plan bilgisi eksik.";
  const title = input.title.trim();
  if (!title) return "Başlık gerekli.";
  const scheduled = new Date(input.scheduledAt);
  if (Number.isNaN(scheduled.getTime())) return "Geçersiz tarih.";
  const validStatuses: CalendarStatus[] = ["draft", "planned", "published", "cancelled"];
  if (!validStatuses.includes(input.status)) return "Geçersiz durum.";
  const validTypes: CalendarItemType[] = ["post", "reel", "story", "note", "task"];
  if (!validTypes.includes(input.itemType)) return "Geçersiz içerik türü.";
  return null;
}

/**
 * Kısmi güncelleme doğrulama (§38). Sunucu adapter'ı
 * ve form paylaşımı için saf fonksiyondur.
 */
export function validateCalendarPatch(patch: {
  title?: string;
  scheduledAt?: string;
  status?: CalendarStatus;
  itemType?: CalendarItemType;
}): string | null {
  if (patch.title !== undefined && !patch.title.trim()) {
    return "Başlık gerekli.";
  }
  if (patch.scheduledAt !== undefined) {
    if (Number.isNaN(new Date(patch.scheduledAt).getTime())) {
      return "Geçersiz tarih.";
    }
  }
  if (patch.status !== undefined) {
    const validStatuses: CalendarStatus[] = ["draft", "planned", "published", "cancelled"];
    if (!validStatuses.includes(patch.status)) return "Geçersiz durum.";
  }
  if (patch.itemType !== undefined) {
    const validTypes: CalendarItemType[] = ["post", "reel", "story", "note", "task"];
    if (!validTypes.includes(patch.itemType)) return "Geçersiz içerik türü.";
  }
  return null;
}

/** Checklist öğesi üretir (§20). */
export function createChecklistItem(label: string, id = randomId()): ChecklistItem {
  return { id, label: label.trim(), done: false };
}

/** Checklist öğesi açma/kapama (saf). */
export function toggleChecklistItem(
  checklist: ChecklistItem[],
  itemId: string,
): ChecklistItem[] {
  return checklist.map((item) =>
    item.id === itemId ? { ...item, done: !item.done } : item,
  );
}

/** İstemci tarafında UUID v4 (Supabase default ile uyumlu). */
export function randomId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Kayıt oluşturma girdisi → CalendarItem (kimlik ve damgalarla). */
export function buildCalendarItem(
  input: {
    brandId: string;
    projectId: string;
    postId: string | null;
    itemType: CalendarItemType;
    title: string;
    description: string;
    scheduledAt: string;
    status: CalendarStatus;
    checklist: ChecklistItem[];
  },
  now = new Date(),
  id = randomId(),
): CalendarItem {
  const timestamp = now.toISOString();
  return { ...input, id, createdAt: timestamp, updatedAt: timestamp };
}

/**
 * Sürükleme sonucundaki yeni planlama zamanı (§21).
 *
 * - Ay görünümü: `date` hedefi gün değiştirir, saat korunur.
 * - Hafta/gün görünümü: `hour` hedefi saati değiştirir,
 *   dakika korunur; `date` varsa gün de değişir.
 */
export interface DragTarget {
  /** Hedef gün (yerel). Ay/hafta sürüklemelerinde kullanılır. */
  date?: Date;
  /** Hedef saat (0–23). Hafta/gün sürüklemelerinde kullanılır. */
  hour?: number;
}

export function computeDraggedScheduledAt(
  item: Pick<CalendarItem, "scheduledAt">,
  target: DragTarget,
): string {
  const source = new Date(item.scheduledAt);
  const result = new Date(item.scheduledAt);
  if (target.date) {
    result.setFullYear(
      target.date.getFullYear(),
      target.date.getMonth(),
      target.date.getDate(),
    );
  }
  if (target.hour !== undefined && target.hour >= 0 && target.hour <= 23) {
    result.setHours(target.hour, source.getMinutes(), 0, 0);
  }
  return result.toISOString();
}

/** Date → "yyyy-mm-dd" (date input değeri). */
export function toDateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Date → "HH:mm" (time input değeri). */
export function toTimeInputValue(date: Date): string {
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

/**
 * Formdan gelen "yyyy-mm-dd" + "HH:mm" değerlerini
 * ISO 8601 zaman damgasına çevirir (yerel saat). */
export function combineDateTime(
  dateValue: string,
  timeValue: string,
): string {
  const [year, month, day] = dateValue.split("-").map(Number);
  const [hours, minutes] = timeValue.split(":").map(Number);
  const date = new Date(
    year || 1970,
    (month || 1) - 1,
    day || 1,
    hours || 0,
    minutes || 0,
    0,
    0,
  );
  return date.toISOString();
}

/** Günlük plan özet sayıları (§31: Bugünkü Plan kartı). */
export interface DaySummary {
  total: number;
  planned: number;
  published: number;
  overdue: number;
  draft: number;
  cancelled: number;
}

export function summarizeDay(
  items: CalendarItem[],
  date: Date,
  now = new Date(),
): DaySummary {
  const dayItems = itemsForDay(items, date);
  const summary: DaySummary = {
    total: dayItems.length,
    planned: 0,
    published: 0,
    overdue: 0,
    draft: 0,
    cancelled: 0,
  };
  for (const item of dayItems) {
    const status = deriveStatus(item, now);
    if (status === "planned") summary.planned += 1;
    else if (status === "published") summary.published += 1;
    else if (status === "overdue") summary.overdue += 1;
    else if (status === "draft") summary.draft += 1;
    else summary.cancelled += 1;
  }
  return summary;
}

/** Yaklaşan kayıtlar: bugün ve son 7 gün, zaman sıralı (§32). */
export function upcomingItems(
  items: CalendarItem[],
  now = new Date(),
  limit = 6,
): CalendarItem[] {
  const horizon = startOfDay(now).getTime() + 7 * 86_400_000;
  return sortByScheduledAt(
    items.filter((item) => {
      if (item.status === "cancelled") return false;
      const time = new Date(item.scheduledAt).getTime();
      return time >= now.getTime() - 1 && time < horizon;
    }),
  ).slice(0, limit);
}
