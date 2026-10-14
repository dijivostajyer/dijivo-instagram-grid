import type { ShareSnapshot } from "./share";

/**
 * Müşteri onay / revize geri bildirimi (Faz 3).
 *
 * Kayıtlar append-only bir olay günlüğüdür: aynı içerik için yeni geri
 * bildirim eski kaydın üzerine yazılmaz, yeni olay eklenir. "Son durum"
 * her hedef için en son olaydır.
 */
export type FeedbackTargetType = "post" | "reel" | "story" | "grid";
export type FeedbackAction = "approved" | "revision_requested";

export const FEEDBACK_TARGET_TYPES: readonly FeedbackTargetType[] = ["post", "reel", "story", "grid"];
export const FEEDBACK_ACTIONS: readonly FeedbackAction[] = ["approved", "revision_requested"];
export const MAX_FEEDBACK_MESSAGE_LENGTH = 2000;
export const MAX_CLIENT_NAME_LENGTH = 80;
export const MAX_FEEDBACK_BODY_BYTES = 8 * 1024;

export const FEEDBACK_ACTION_LABELS: Record<FeedbackAction, string> = {
  approved: "Onaylandı",
  revision_requested: "Revize İstendi",
};

export const FEEDBACK_TARGET_LABELS: Record<FeedbackTargetType, string> = {
  post: "Post",
  reel: "Reel",
  story: "Story",
  grid: "Grid",
};

/** İstemcinin gönderebileceği alanlar. Tarih, marka, plan ve kimlik sunucudan gelir. */
export interface FeedbackRequest {
  targetType: FeedbackTargetType;
  targetId: string | null;
  action: FeedbackAction;
  message: string | null;
  clientName: string;
}

/** Saklanan geri bildirim olayı. `createdAt` veritabanı/sunucu saatidir. */
export interface FeedbackRecord extends FeedbackRequest {
  id: string;
  shareToken: string;
  brandId: string | null;
  projectId: string | null;
  createdAt: string;
}

/** Paylaşım sayfasına gönderilen, müşterinin görebileceği alanlar. */
export type PublicFeedbackRecord = Pick<FeedbackRecord, "id" | "targetType" | "targetId" | "action" | "message" | "clientName" | "createdAt">;

export type FeedbackValidation =
  | { ok: true; value: FeedbackRequest }
  | { ok: false; error: string; code: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Boşlukları sadeleştirir; kontrol karakterlerini atar (satır sonu korunur). */
function cleanText(value: string, keepNewlines: boolean): string {
  // eslint-disable-next-line no-control-regex
  const withoutControl = value.replace(keepNewlines ? /[\u0000-\u0009\u000B-\u001F\u007F]/g : /[\u0000-\u001F\u007F]/g, "");
  return keepNewlines ? withoutControl.trim() : withoutControl.replace(/\s+/g, " ").trim();
}

/** Geri bildirim isteğini doğrular. Bilinmeyen alanlar (ör. createdAt) yok sayılır. */
export function validateFeedbackRequest(body: unknown): FeedbackValidation {
  if (!isRecord(body)) return { ok: false, error: "Geçersiz istek.", code: "FEEDBACK_INVALID_BODY" };
  const { targetType, targetId, action, message, clientName } = body;
  if (typeof action !== "string" || !FEEDBACK_ACTIONS.includes(action as FeedbackAction)) {
    return { ok: false, error: "Geçersiz geri bildirim türü.", code: "FEEDBACK_INVALID_ACTION" };
  }
  if (typeof targetType !== "string" || !FEEDBACK_TARGET_TYPES.includes(targetType as FeedbackTargetType)) {
    return { ok: false, error: "Geçersiz içerik türü.", code: "FEEDBACK_INVALID_TARGET" };
  }
  let normalizedTargetId: string | null = null;
  if (targetType === "grid") {
    if (targetId !== undefined && targetId !== null) {
      return { ok: false, error: "Grid geri bildirimi belirli bir içeriğe bağlanamaz.", code: "FEEDBACK_INVALID_TARGET" };
    }
  } else {
    if (typeof targetId !== "string" || targetId.length === 0 || targetId.length > 200) {
      return { ok: false, error: "Geri bildirim verilen içerik bulunamadı.", code: "FEEDBACK_INVALID_TARGET" };
    }
    normalizedTargetId = targetId;
  }
  if (typeof clientName !== "string") {
    return { ok: false, error: "Lütfen adınızı yazın.", code: "FEEDBACK_NAME_REQUIRED" };
  }
  const name = cleanText(clientName, false);
  if (name.length < 2) return { ok: false, error: "Lütfen adınızı yazın.", code: "FEEDBACK_NAME_REQUIRED" };
  if (name.length > MAX_CLIENT_NAME_LENGTH) {
    return { ok: false, error: `Ad en fazla ${MAX_CLIENT_NAME_LENGTH} karakter olabilir.`, code: "FEEDBACK_NAME_TOO_LONG" };
  }
  if (message !== undefined && message !== null && typeof message !== "string") {
    return { ok: false, error: "Geçersiz mesaj.", code: "FEEDBACK_INVALID_MESSAGE" };
  }
  const text = typeof message === "string" ? cleanText(message, true) : "";
  if (text.length > MAX_FEEDBACK_MESSAGE_LENGTH) {
    return { ok: false, error: `Mesaj en fazla ${MAX_FEEDBACK_MESSAGE_LENGTH} karakter olabilir.`, code: "FEEDBACK_MESSAGE_TOO_LONG" };
  }
  if (action === "revision_requested" && text.length === 0) {
    return { ok: false, error: "Lütfen revize talebinizi yazın.", code: "FEEDBACK_MESSAGE_REQUIRED" };
  }
  return {
    ok: true,
    value: {
      targetType: targetType as FeedbackTargetType,
      targetId: normalizedTargetId,
      action: action as FeedbackAction,
      message: text.length > 0 ? text : null,
      clientName: name,
    },
  };
}

/**
 * Hedef snapshot'ta gerçekten var mı ve türü doğru mu? Uydurma veya başka
 * paylaşıma ait kimlikler reddedilir. Carousel, Post olarak değerlendirilir.
 */
export function isFeedbackTargetInSnapshot(
  snapshot: Pick<ShareSnapshot, "cells" | "stories">,
  targetType: FeedbackTargetType,
  targetId: string | null,
): boolean {
  if (targetType === "grid") return targetId === null;
  if (targetType === "story") return (snapshot.stories ?? []).some((story) => story.id === targetId);
  const cell = snapshot.cells.find((item) => item.id === targetId);
  if (!cell) return false;
  return targetType === "reel" ? cell.postType === "reel" : cell.postType !== "reel";
}

/** Hücrenin geri bildirim türü (Reel ayrı, Post/Carousel post). */
export function feedbackTargetTypeForPost(postType: string | undefined): FeedbackTargetType {
  return postType === "reel" ? "reel" : "post";
}

export function feedbackTargetKey(targetType: FeedbackTargetType, targetId: string | null): string {
  return targetType === "grid" ? "grid" : `${targetType}:${targetId}`;
}

/**
 * Her hedef için en son geri bildirim. Kayıtlar oluşturulma zamanına göre
 * sıralanır; aynı anda oluşmuş kayıtlarda listedeki (ekleme) sırası
 * belirleyicidir. Geçmiş kayıtlar değiştirilmez.
 */
export function latestFeedbackByTarget<T extends Pick<FeedbackRecord, "targetType" | "targetId" | "createdAt">>(
  records: readonly T[],
): Map<string, T> {
  const ordered = records
    .map((record, index) => ({ record, index, time: Date.parse(record.createdAt) }))
    .sort((a, b) => (a.time - b.time) || (a.index - b.index));
  const latest = new Map<string, T>();
  for (const { record } of ordered) latest.set(feedbackTargetKey(record.targetType, record.targetId), record);
  return latest;
}

export function toPublicFeedback(record: FeedbackRecord): PublicFeedbackRecord {
  return {
    id: record.id,
    targetType: record.targetType,
    targetId: record.targetId,
    action: record.action,
    message: record.message,
    clientName: record.clientName,
    createdAt: record.createdAt,
  };
}

/** Kullanıcının yerel ayarıyla tarih + saat (DB UTC tutar). */
export function formatFeedbackTime(value: string, locale?: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(locale ?? "tr-TR", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
