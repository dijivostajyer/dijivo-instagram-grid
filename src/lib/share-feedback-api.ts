import type { ShareStore } from "./share-store";
import { isValidShareToken } from "./share-token";
import {
  MAX_FEEDBACK_BODY_BYTES,
  isFeedbackTargetInSnapshot,
  latestFeedbackByTarget,
  toPublicFeedback,
  validateFeedbackRequest,
  type PublicFeedbackRecord,
} from "./share-feedback";
import type { ShareFeedbackStore } from "./share-feedback-store";
import { clientIpFromHeaders, type RateLimiter } from "./rate-limit";

/**
 * Public geri bildirim uç noktasının çekirdeği. Route dosyası yalnız
 * bağımlılıkları bağlar; burada test edilebilir:
 *
 * 1. token biçimi → 2. süreç içi hız sınırı (IP + token) → 3. gövde boyutu
 * ve JSON → 4. alan doğrulaması → 5. snapshot geçerli mi (süre/iptal) →
 * 6. hedef snapshot içinde mi → 7. paylaşım başına kalıcı saatlik üst sınır
 * → 8. kayıt (tarih sunucu/veritabanı tarafından).
 */
export interface FeedbackApiDeps {
  shareStore: Pick<ShareStore, "peek">;
  feedbackStore: ShareFeedbackStore;
  rateLimiter: RateLimiter;
  /** Paylaşım başına saatlik kalıcı üst sınır (yeniden başlatmaya dayanıklı). */
  maxPerShareHour?: number;
  now?: () => Date;
}

export const DEFAULT_MAX_FEEDBACK_PER_SHARE_HOUR = 60;

type ApiResult = { status: number; body: Record<string, unknown> };

const UNAVAILABLE = { error: "Paylaşım bağlantısı bulunamadı veya süresi doldu.", code: "SHARE_UNAVAILABLE" };
const TOO_MANY = { error: "Çok fazla geri bildirim gönderildi. Lütfen biraz sonra tekrar deneyin.", code: "FEEDBACK_RATE_LIMITED" };

export async function handleFeedbackPost(request: Request, token: string, deps: FeedbackApiDeps): Promise<ApiResult> {
  if (!isValidShareToken(token)) return { status: 404, body: UNAVAILABLE };
  if (!deps.rateLimiter.take(`${clientIpFromHeaders(request.headers)}:${token}`)) return { status: 429, body: TOO_MANY };

  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_FEEDBACK_BODY_BYTES) {
    return { status: 413, body: { error: "Geri bildirim çok uzun.", code: "FEEDBACK_TOO_LARGE" } };
  }
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { parsed = null; }
  const validation = validateFeedbackRequest(parsed);
  if (!validation.ok) return { status: 400, body: { error: validation.error, code: validation.code } };

  const snapshot = await deps.shareStore.peek(token);
  if (!snapshot) return { status: 404, body: UNAVAILABLE };
  const { targetType, targetId } = validation.value;
  if (!isFeedbackTargetInSnapshot(snapshot, targetType, targetId)) {
    return { status: 400, body: { error: "Geri bildirim verilen içerik bu paylaşımda bulunamadı.", code: "FEEDBACK_UNKNOWN_TARGET" } };
  }

  const now = deps.now?.() ?? new Date();
  const recent = await deps.feedbackStore.countSince(token, new Date(now.getTime() - 60 * 60 * 1000));
  if (recent >= (deps.maxPerShareHour ?? DEFAULT_MAX_FEEDBACK_PER_SHARE_HOUR)) return { status: 429, body: TOO_MANY };

  const record = await deps.feedbackStore.add({
    ...validation.value,
    shareToken: token,
    // İlişki istemciden değil, sunucunun doğruladığı snapshot'tan gelir.
    brandId: snapshot.context?.brandId ?? null,
    projectId: snapshot.context?.projectId ?? null,
  });
  return { status: 201, body: { feedback: toPublicFeedback(record) } };
}

/** Paylaşımdaki her hedefin son durumu (müşteri ekranı için). */
export async function listLatestFeedback(token: string, deps: Pick<FeedbackApiDeps, "shareStore" | "feedbackStore">): Promise<PublicFeedbackRecord[] | null> {
  if (!isValidShareToken(token)) return null;
  const snapshot = await deps.shareStore.peek(token);
  if (!snapshot) return null;
  const records = await deps.feedbackStore.list(token);
  return [...latestFeedbackByTarget(records).values()].map(toPublicFeedback);
}

export async function handleFeedbackGet(token: string, deps: Pick<FeedbackApiDeps, "shareStore" | "feedbackStore">): Promise<ApiResult> {
  const latest = await listLatestFeedback(token, deps);
  if (!latest) return { status: 404, body: UNAVAILABLE };
  return { status: 200, body: { latest } };
}
