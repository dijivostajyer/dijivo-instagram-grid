/**
 * Takvim / İçerik Planlama / Hatırlatma modülü — veri modeli.
 *
 * Takvim kayıtları Grid Planner gönderilerini kopyalamaz;
 * `postId` referansıyla mevcut Post/Reel'le bağlanabilir
 * (§13). Gönderi silindiğinde bağlantı kopar — UI
 * "Bağlı içerik bulunamadı" fallback'i gösterir (§37).
 */

/** Planlama kaydı türü (§18/§19: görev ve not da desteklenir). */
export type CalendarItemType = "post" | "reel" | "story" | "note" | "task";

/** Kalıcı durum. "overdue" türetilmiş durumdur, saklanmaz (§7). */
export type CalendarStatus = "draft" | "planned" | "published" | "cancelled";

/** UI'da gösterilen durum: kalıcı + türetilmiş "overdue". */
export type DisplayStatus = CalendarStatus | "overdue";

/** Checklist öğesi (§20). */
export interface ChecklistItem {
  id: string;
  label: string;
  done: boolean;
}

/** Takvim planlama kaydı. */
export interface CalendarItem {
  id: string;
  brandId: string;
  projectId: string;
  /** Bağlı Grid Planner gönderisi (§13); görev/not için boş. */
  postId: string | null;
  itemType: CalendarItemType;
  title: string;
  description: string;
  /** Planlanan tarih+saat (ISO 8601). */
  scheduledAt: string;
  status: CalendarStatus;
  /** Hatırlatma ön süresi (dakika); null = hatırlatma yok (§12). */
  reminderOffsetMinutes: number | null;
  checklist: ChecklistItem[];
  createdAt: string;
  updatedAt: string;
}

/**
 * Hatırlatma teslim kaydı (§27 once-only delivery).
 * `(itemId, remindAt)` eşsizdir: aynı hatırlatma
 * bir kez teslim edilir, tekrar etmez.
 */
export interface ReminderDelivery {
  id: string;
  itemId: string;
  brandId: string;
  channel: NotificationChannel;
  remindAt: string;
  scheduledAt: string;
  title: string;
  body: string;
  createdAt: string;
  deliveredAt: string;
  readAt: string | null;
}

/**
 * Bildirim kanalı (§30: provider-independent tasarım).
 * Bu fazda in_app çalışır; browser_push ve email
 * altyapısı hazırlıktadır.
 */
export type NotificationChannel = "in_app" | "browser_push" | "email";

/** Hatırlatma seçenekleri (§12). `custom` için dakika değeri eklenir. */
export interface ReminderOption {
  value: number | null;
  label: string;
}

export const REMINDER_OPTIONS: ReminderOption[] = [
  { value: null, label: "Hatırlatma yok" },
  { value: 15, label: "15 dakika önce" },
  { value: 60, label: "1 saat önce" },
  { value: 1440, label: "1 gün önce" },
  { value: 2880, label: "2 gün önce" },
  { value: -1, label: "Özel" },
];

/** Durum meta bilgisi: renk + metin (§8: renk tek başına yetmez). */
export const STATUS_META: Record<
  DisplayStatus,
  { label: string; classes: string; dot: string }
> = {
  draft: {
    label: "Taslak",
    classes: "bg-neutral-100 text-neutral-700 ring-neutral-300",
    dot: "bg-neutral-500",
  },
  planned: {
    label: "Planlandı",
    classes: "bg-sky-50 text-sky-800 ring-sky-200",
    dot: "bg-sky-600",
  },
  published: {
    label: "Yayınlandı",
    classes: "bg-emerald-50 text-emerald-800 ring-emerald-200",
    dot: "bg-emerald-600",
  },
  overdue: {
    label: "Gecikti",
    classes: "bg-amber-50 text-amber-800 ring-amber-300",
    dot: "bg-amber-600",
  },
  cancelled: {
    label: "İptal",
    classes: "bg-neutral-100 text-neutral-400 ring-neutral-200",
    dot: "bg-neutral-400",
  },
};

/** İçerik türü meta bilgisi (ikon metni + etiket). */
export const ITEM_TYPE_META: Record<
  CalendarItemType,
  { label: string; shortLabel: string }
> = {
  post: { label: "Post", shortLabel: "Post" },
  reel: { label: "Reel", shortLabel: "Reel" },
  story: { label: "Story", shortLabel: "Story" },
  note: { label: "Not", shortLabel: "Not" },
  task: { label: "Görev", shortLabel: "Görev" },
};

/** API'den gelen ham satır (snake_case → camelCase dönüşümü yapılır). */
export interface CalendarItemRow {
  id: string;
  brand_id: string;
  project_id: string;
  post_id: string | null;
  item_type: CalendarItemType;
  title: string;
  description: string;
  scheduled_at: string;
  status: CalendarStatus;
  reminder_offset_minutes: number | null;
  checklist: ChecklistItem[];
  created_at: string;
  updated_at: string;
}

export interface ReminderDeliveryRow {
  id: string;
  item_id: string;
  brand_id: string;
  channel: NotificationChannel;
  remind_at: string;
  scheduled_at: string;
  title: string;
  body: string;
  created_at: string;
  delivered_at: string;
  read_at: string | null;
}
