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
  /** Checklist (§20). */
  checklist: ChecklistItem[];
  /** Oluşturulma anı (ISO 8601). */
  createdAt: string;
  /** Son güncelleme anı (ISO 8601). */
  updatedAt: string;
}

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
  checklist: ChecklistItem[];
  created_at: string;
  updated_at: string;
}

