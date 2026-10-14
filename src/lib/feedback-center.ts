import { deserializeShareSnapshot } from "./share";
import {
  FEEDBACK_ACTIONS,
  FEEDBACK_TARGET_TYPES,
  type FeedbackAction,
  type FeedbackTargetType,
} from "./share-feedback";
import type { PostType } from "./types";

/**
 * Geri Dönüşler merkezi (Faz 4): ekibin müşteri geri bildirimlerini
 * izlediği ekranın saf modeli.
 *
 * Müşteri eylemi (`action`) değişmez; ekip yalnız iç iş akışı durumunu
 * (`workflowStatus`) ve okundu bilgisini (`readAt`) yönetir.
 */
export type WorkflowStatus = "new" | "in_review" | "revision_done" | "closed";

export const WORKFLOW_STATUSES: readonly WorkflowStatus[] = ["new", "in_review", "revision_done", "closed"];

export const WORKFLOW_LABELS: Record<WorkflowStatus, string> = {
  new: "Yeni",
  in_review: "İnceleniyor",
  revision_done: "Revize Tamamlandı",
  closed: "Kapatıldı",
};

export const CENTER_TARGET_LABELS: Record<FeedbackTargetType, string> = {
  post: "Post",
  reel: "Reel",
  story: "Story",
  grid: "Tüm Grid",
};

export const FEEDBACK_PAGE_SIZE = 50;
export const MAX_FEEDBACK_PAGE_SIZE = 100;
const MAX_SEARCH_LENGTH = 80;
const MAX_FILTER_IDS = 100;

/** Merkezde listelenen geri bildirim olayı (müşteri alanları + iç alanlar). */
export interface FeedbackCenterRecord {
  id: string;
  shareToken: string;
  brandId: string | null;
  projectId: string | null;
  targetType: FeedbackTargetType;
  targetId: string | null;
  action: FeedbackAction;
  message: string | null;
  clientName: string;
  createdAt: string;
  workflowStatus: WorkflowStatus;
  workflowUpdatedAt: string | null;
  readAt: string | null;
}

/** Müşterinin gördüğü içerik (paylaşım snapshot'ından), güvenli URL ile. */
export interface FeedbackPreview {
  kind: "image" | "video" | "grid" | "unavailable";
  url?: string;
  postType?: PostType;
  caption?: string;
  alt?: string;
  /** Grid için paylaşımdaki içerik sayısı. */
  cellCount?: number;
}

export interface FeedbackShareInfo {
  token: string;
  createdAt: string | null;
  expiresAt: string | null;
  status: "active" | "expired" | "revoked" | "missing";
}

export interface FeedbackCenterItem extends FeedbackCenterRecord {
  preview: FeedbackPreview;
  share: FeedbackShareInfo;
}

/** Ekip içi durum değişikliği (yalnız eklenir). */
export interface FeedbackWorkflowEvent {
  id: string;
  feedbackId: string;
  status: WorkflowStatus;
  createdAt: string;
}

export interface FeedbackDetail {
  item: FeedbackCenterItem;
  /** Aynı hedefin tüm müşteri geri bildirimleri, eskiden yeniye. */
  history: FeedbackCenterRecord[];
  /** Bu geçmişteki kayıtların iç durum değişiklikleri, eskiden yeniye. */
  events: FeedbackWorkflowEvent[];
}

export interface FeedbackListResult {
  items: FeedbackCenterItem[];
  hasMore: boolean;
  nextOffset: number;
  unreadCount: number;
}

export interface FeedbackListQuery {
  brandId?: string;
  projectIds?: string[];
  targetType?: FeedbackTargetType;
  action?: FeedbackAction;
  workflowStatus?: WorkflowStatus;
  unreadOnly?: boolean;
  /** Müşteri adı ve mesajda aranır (sunucu). */
  q?: string;
  /** Adı/@kullanıcı adı aramayla eşleşen markalar (istemci hesaplar). */
  qBrandIds?: string[];
  order: "desc" | "asc";
  limit: number;
  offset: number;
}

function isWorkflowStatus(value: unknown): value is WorkflowStatus {
  return typeof value === "string" && (WORKFLOW_STATUSES as readonly string[]).includes(value);
}

export function parseWorkflowStatus(value: unknown): WorkflowStatus | null {
  return isWorkflowStatus(value) ? value : null;
}

/** Kimlik listesi: güvenli karakterler, makul uzunluk ve adet. */
function parseIds(value: string | null): string[] | undefined {
  if (!value) return undefined;
  const ids = value.split(",").map((id) => id.trim()).filter((id) => /^[A-Za-z0-9_.:-]{1,200}$/.test(id));
  return ids.length ? ids.slice(0, MAX_FILTER_IDS) : undefined;
}

/**
 * Serbest metin araması: sorgu dili karakterleri (virgül, parantez, joker,
 * tırnak) atılır; PostgREST filtresine güvenle konabilir.
 */
export function sanitizeFeedbackSearch(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const cleaned = value.replace(/[,()"'\\%*_:;]/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_SEARCH_LENGTH);
  return cleaned.length >= 2 ? cleaned : undefined;
}

export function parseFeedbackListQuery(params: URLSearchParams): FeedbackListQuery {
  const limit = Number(params.get("limit") ?? FEEDBACK_PAGE_SIZE);
  const offset = Number(params.get("offset") ?? 0);
  const targetType = params.get("targetType");
  const action = params.get("action");
  const brandId = parseIds(params.get("brandId"))?.[0];
  return {
    ...(brandId ? { brandId } : {}),
    ...(parseIds(params.get("projectIds")) ? { projectIds: parseIds(params.get("projectIds")) } : {}),
    ...(targetType && (FEEDBACK_TARGET_TYPES as readonly string[]).includes(targetType) ? { targetType: targetType as FeedbackTargetType } : {}),
    ...(action && (FEEDBACK_ACTIONS as readonly string[]).includes(action) ? { action: action as FeedbackAction } : {}),
    ...(isWorkflowStatus(params.get("workflow")) ? { workflowStatus: params.get("workflow") as WorkflowStatus } : {}),
    ...(params.get("unread") === "1" ? { unreadOnly: true } : {}),
    ...(sanitizeFeedbackSearch(params.get("q")) ? { q: sanitizeFeedbackSearch(params.get("q")) } : {}),
    ...(parseIds(params.get("qBrandIds")) ? { qBrandIds: parseIds(params.get("qBrandIds")) } : {}),
    order: params.get("order") === "asc" ? "asc" : "desc",
    limit: Number.isInteger(limit) && limit > 0 ? Math.min(limit, MAX_FEEDBACK_PAGE_SIZE) : FEEDBACK_PAGE_SIZE,
    offset: Number.isInteger(offset) && offset >= 0 ? Math.min(offset, 100_000) : 0,
  };
}

export function feedbackListQueryToParams(query: Partial<FeedbackListQuery>): URLSearchParams {
  const params = new URLSearchParams();
  if (query.brandId) params.set("brandId", query.brandId);
  if (query.projectIds?.length) params.set("projectIds", query.projectIds.join(","));
  if (query.targetType) params.set("targetType", query.targetType);
  if (query.action) params.set("action", query.action);
  if (query.workflowStatus) params.set("workflow", query.workflowStatus);
  if (query.unreadOnly) params.set("unread", "1");
  if (query.q) params.set("q", query.q);
  if (query.qBrandIds?.length) params.set("qBrandIds", query.qBrandIds.join(","));
  if (query.order === "asc") params.set("order", "asc");
  if (query.limit) params.set("limit", String(query.limit));
  if (query.offset) params.set("offset", String(query.offset));
  return params;
}

function foldTurkish(value: string): string {
  return value.toLocaleLowerCase("tr-TR");
}

/** Sunucu sorgusunun bellek içi eşdeğeri (test ve geliştirme sürücüsü). */
export function matchesFeedbackListQuery(record: FeedbackCenterRecord, query: FeedbackListQuery): boolean {
  if (query.brandId && record.brandId !== query.brandId) return false;
  if (query.projectIds && !(record.projectId && query.projectIds.includes(record.projectId))) return false;
  if (query.targetType && record.targetType !== query.targetType) return false;
  if (query.action && record.action !== query.action) return false;
  if (query.workflowStatus && record.workflowStatus !== query.workflowStatus) return false;
  if (query.unreadOnly && record.readAt) return false;
  if (query.q) {
    const needle = foldTurkish(query.q);
    const inText = foldTurkish(record.clientName).includes(needle) || foldTurkish(record.message ?? "").includes(needle);
    const inBrand = Boolean(record.brandId && query.qBrandIds?.includes(record.brandId));
    if (!inText && !inBrand) return false;
  }
  return true;
}

/** En yeni üstte (varsayılan) veya en eski üstte; eşit zamanda kimliğe göre kararlı. */
export function sortFeedbackRecords<T extends Pick<FeedbackCenterRecord, "createdAt" | "id">>(records: readonly T[], order: "desc" | "asc"): T[] {
  const direction = order === "asc" ? 1 : -1;
  return [...records].sort((a, b) => direction * (Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id)));
}

/**
 * "Aynı içerik" tanımı: Post/Reel/Story için hedef türü + kimlik (aynı
 * gönderi farklı paylaşımlarda da aynı içeriktir); tüm grid için aynı aylık
 * plan (plan bilinmiyorsa aynı paylaşım).
 */
export function isSameFeedbackTarget(a: FeedbackCenterRecord, b: FeedbackCenterRecord): boolean {
  if (a.targetType !== b.targetType) return false;
  if (a.targetType !== "grid") return a.targetId === b.targetId;
  return a.projectId ? a.projectId === b.projectId : a.shareToken === b.shareToken;
}

export type FeedbackTimelineEntry =
  | { kind: "customer"; at: string; record: FeedbackCenterRecord }
  | { kind: "workflow"; at: string; event: FeedbackWorkflowEvent };

/** Müşteri olayları ve ekip durum değişiklikleri tek kronolojik akışta. */
export function buildFeedbackTimeline(history: readonly FeedbackCenterRecord[], events: readonly FeedbackWorkflowEvent[]): FeedbackTimelineEntry[] {
  const entries: FeedbackTimelineEntry[] = [
    ...history.map((record) => ({ kind: "customer" as const, at: record.createdAt, record })),
    ...events.map((event) => ({ kind: "workflow" as const, at: event.createdAt, event })),
  ];
  return entries
    .map((entry, index) => ({ entry, index, time: Date.parse(entry.at) }))
    .sort((a, b) => (a.time - b.time) || (a.index - b.index))
    .map(({ entry }) => entry);
}

/** Paylaşım bağlantısının durumu (süre/iptal). */
export function shareStatus(row: { expiresAt: string | null; revokedAt: string | null } | null, now: Date): FeedbackShareInfo["status"] {
  if (!row) return "missing";
  if (row.revokedAt) return "revoked";
  if (row.expiresAt && Date.parse(row.expiresAt) <= now.getTime()) return "expired";
  return "active";
}

/** Snapshot içindeki hedef medya: imzalanmamış ham referans ile. */
export interface SnapshotTarget {
  kind: FeedbackPreview["kind"];
  /** `storage:shares/…`, `storage:media/…`, http(s) veya data URL. */
  ref?: string;
  postType?: PostType;
  caption?: string;
  alt?: string;
  cellCount?: number;
}

/**
 * Geri bildirimin hedefini paylaşım snapshot'ında bulur. Bozuk/eski payload
 * veya bulunamayan hedef çökme yerine "unavailable" döner.
 */
export function extractSnapshotTarget(payload: unknown, targetType: FeedbackTargetType, targetId: string | null): SnapshotTarget {
  let snapshot: ReturnType<typeof deserializeShareSnapshot> = null;
  try {
    snapshot = deserializeShareSnapshot(JSON.stringify(payload));
  } catch {
    snapshot = null;
  }
  if (!snapshot) return { kind: "unavailable" };
  if (targetType === "grid") return { kind: "grid", cellCount: snapshot.cells.length };
  if (targetType === "story") {
    const story = snapshot.stories?.find((item) => item.id === targetId);
    return story ? { kind: story.mediaType === "video" ? "video" : "image", ref: story.mediaUrl } : { kind: "unavailable" };
  }
  const cell = snapshot.cells.find((item) => item.id === targetId);
  if (!cell) return { kind: "unavailable" };
  // Gridde görünen kapak (Reel'de kapak varsa kapak), editörle aynı kural.
  const ref = cell.mediaType === "video" && cell.coverImageUrl ? cell.coverImageUrl : cell.imageUrl;
  return { kind: "image", ref, postType: cell.postType ?? "post", caption: cell.caption, alt: cell.alt };
}

/** UTC zaman damgasını kullanıcının yerel saatiyle "14 Ekim 2026, 13:42" biçiminde yazar. */
export function formatFeedbackDateTime(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const day = date.toLocaleDateString("tr-TR", { day: "numeric", month: "long", year: "numeric" });
  const time = date.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
  return `${day}, ${time}`;
}

/** "Projeye Git": hangi plan, hangi içerik ve hangi sekme açılacak. */
export interface FeedbackNavigation {
  brandId: string | null;
  projectId: string;
  /** Post/Reel hâlâ plandaysa açılacak içerik (modal). */
  postId: string | null;
  /** Story geri bildiriminde Grid Planner'ın Story sekmesi açılır. */
  openStories: boolean;
}

export function resolveFeedbackNavigation(
  projects: ReadonlyArray<{ id: string; brandId?: string | null; existingPosts: Array<{ id: string }>; plannedPosts: Array<{ id: string }> }>,
  target: { brandId: string | null; projectId: string | null; targetType: FeedbackTargetType; targetId: string | null },
): FeedbackNavigation | null {
  const project = projects.find((item) => item.id === target.projectId);
  if (!project) return null;
  const isPost = target.targetType === "post" || target.targetType === "reel";
  const postExists = isPost && Boolean(target.targetId) && [...project.existingPosts, ...project.plannedPosts].some((post) => post.id === target.targetId);
  return {
    brandId: project.brandId ?? target.brandId,
    projectId: project.id,
    postId: postExists ? target.targetId : null,
    openStories: target.targetType === "story",
  };
}
