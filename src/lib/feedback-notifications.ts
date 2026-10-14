import type { FeedbackCenterRecord } from "./feedback-center";
import type { FeedbackAction, FeedbackTargetType } from "./share-feedback";

/**
 * Uygulama içi geri bildirim bildirimleri (Faz 5).
 *
 * Kaynak share_feedback'tir: ayrı bildirim tablosu yoktur. `read_at IS NULL`
 * okunmamış demektir; rozet sayısı ve liste buradan türetilir.
 */

/** Uygulama açık ve görünürken yoklama aralığı. */
export const NOTIFICATION_POLL_MS = 60_000;
/** Hata sonrası yoklama aralığı en fazla bu kadar uzar. */
export const NOTIFICATION_MAX_BACKOFF_MS = 5 * 60_000;
export const NOTIFICATION_LIMIT = 8;
export const MAX_NOTIFICATION_LIMIT = 20;
const MESSAGE_PREVIEW_LENGTH = 140;

/** Açılır listede gösterilen hafif kayıt (medya yok). */
export interface FeedbackNotificationItem {
  id: string;
  brandId: string | null;
  projectId: string | null;
  targetType: FeedbackTargetType;
  targetId: string | null;
  action: FeedbackAction;
  /** Mesajın kısa özeti (en fazla 140 karakter). */
  messagePreview: string | null;
  clientName: string;
  createdAt: string;
  readAt: string | null;
}

export interface FeedbackNotificationSummary {
  /** Kullanıcının okunmamış geri bildirim sayısı. */
  count: number;
  /** En yeni bildirimler (okunmuş/okunmamış), en yeni üstte. */
  items: FeedbackNotificationItem[];
}

/** 0 → rozet yok; 1–99 → sayı; 99 üzeri → "99+". */
export function formatBadgeCount(count: number): string | null {
  if (!Number.isFinite(count) || count <= 0) return null;
  return count > 99 ? "99+" : String(Math.floor(count));
}

export function messagePreview(message: string | null): string | null {
  if (!message) return null;
  const flat = message.replace(/\s+/g, " ").trim();
  if (!flat) return null;
  return flat.length > MESSAGE_PREVIEW_LENGTH ? `${flat.slice(0, MESSAGE_PREVIEW_LENGTH - 1).trimEnd()}…` : flat;
}

export function toNotificationItem(record: FeedbackCenterRecord): FeedbackNotificationItem {
  return {
    id: record.id,
    brandId: record.brandId,
    projectId: record.projectId,
    targetType: record.targetType,
    targetId: record.targetId,
    action: record.action,
    messagePreview: messagePreview(record.message),
    clientName: record.clientName,
    createdAt: record.createdAt,
    readAt: record.readAt,
  };
}

/** Türkçe ek: Post'u, Reel'i, Story'yi. */
const ACCUSATIVE: Record<Exclude<FeedbackTargetType, "grid">, string> = {
  post: "Post'u",
  reel: "Reel'i",
  story: "Story'yi",
};

const NOMINATIVE: Record<Exclude<FeedbackTargetType, "grid">, string> = {
  post: "Post",
  reel: "Reel",
  story: "Story",
};

/**
 * Doğal Türkçe bildirim cümlesi. Ay biliniyorsa eklenir:
 * "Moda Butik, Ekim 2026 planındaki Reel için revize istedi."
 */
export function feedbackNotificationText(input: {
  brandName: string;
  monthLabel?: string | null;
  targetType: FeedbackTargetType;
  action: FeedbackAction;
}): string {
  const { brandName, monthLabel, targetType, action } = input;
  if (targetType === "grid") {
    if (action === "approved") return monthLabel ? `${brandName}, ${monthLabel} grid planını onayladı.` : `${brandName}, grid planını onayladı.`;
    return monthLabel ? `${brandName}, ${monthLabel} gridi için genel revize istedi.` : `${brandName}, grid için genel revize istedi.`;
  }
  if (action === "approved") {
    return monthLabel
      ? `${brandName}, ${monthLabel} planındaki ${ACCUSATIVE[targetType]} onayladı.`
      : `${brandName}, bir ${ACCUSATIVE[targetType]} onayladı.`;
  }
  return monthLabel
    ? `${brandName}, ${monthLabel} planındaki ${NOMINATIVE[targetType]} için revize istedi.`
    : `${brandName}, bir ${NOMINATIVE[targetType]} için revize istedi.`;
}

/** Bildirim listesinde yerel olarak okundu işaretleme (sunucu yanıtından sonra). */
export function markItemsRead(items: FeedbackNotificationItem[], ids: readonly string[] | "all", readAt: string): FeedbackNotificationItem[] {
  return items.map((item) => (!item.readAt && (ids === "all" || ids.includes(item.id)) ? { ...item, readAt } : item));
}
