import {
  extractSnapshotTarget,
  isSameFeedbackTarget,
  matchesFeedbackListQuery,
  parseWorkflowStatus,
  shareStatus,
  sortFeedbackRecords,
  type FeedbackCenterItem,
  type FeedbackCenterRecord,
  type FeedbackDetail,
  type FeedbackListQuery,
  type FeedbackListResult,
  type FeedbackPreview,
  type FeedbackWorkflowEvent,
  type WorkflowStatus,
} from "./feedback-center";
import {
  MAX_NOTIFICATION_LIMIT,
  NOTIFICATION_LIMIT,
  toNotificationItem,
  type FeedbackNotificationSummary,
} from "./feedback-notifications";

/** Önizleme için gereken snapshot satırı (medya imzalanmamış). */
export interface FeedbackSnapshotRow {
  token: string;
  payload: unknown;
  createdAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
}

/**
 * Veri erişimi. Her okuma/yazma `userId` ile kapsamlıdır: kullanıcı yalnız
 * kendi markalarına ait geri bildirimleri görür ve günceller.
 */
export interface FeedbackCenterDriver {
  list(userId: string, query: FeedbackListQuery): Promise<{ records: FeedbackCenterRecord[]; hasMore: boolean }>;
  countUnread(userId: string): Promise<number>;
  get(userId: string, id: string): Promise<FeedbackCenterRecord | null>;
  /** Aynı hedefin geçmişi, eskiden yeniye (en fazla 200). */
  history(userId: string, record: FeedbackCenterRecord): Promise<FeedbackCenterRecord[]>;
  events(userId: string, feedbackIds: string[]): Promise<FeedbackWorkflowEvent[]>;
  snapshots(tokens: string[]): Promise<Map<string, FeedbackSnapshotRow>>;
  /** `shares/…` (share-images) ve `media/…` (share-media) yollarını imzalar. */
  sign(paths: { images: string[]; media: string[] }): Promise<Map<string, string>>;
  /** İç durumu günceller ve iç olay ekler; müşteri alanlarına dokunmaz. */
  setWorkflow(userId: string, id: string, status: WorkflowStatus): Promise<FeedbackCenterRecord | null>;
  /** Okunmamışları okundu yapar (zaten okunmuşların tarihi değişmez). */
  markRead(userId: string, ids: string[]): Promise<string[]>;
  /** Bildirim listesi: en yeni kayıtlar (medya yok), en yeni üstte. */
  recent(userId: string, limit: number): Promise<FeedbackCenterRecord[]>;
  /** Kullanıcının tüm okunmamışlarını okundu yapar; etkilenen sayıyı döner. */
  markAllRead(userId: string): Promise<number>;
}

type Result = { status: number; body: Record<string, unknown> };

function previewUrl(ref: string | undefined, signed: Map<string, string>): string | undefined {
  if (!ref) return undefined;
  if (ref.startsWith("storage:")) return signed.get(ref.slice("storage:".length));
  if (/^https?:\/\//i.test(ref) || /^data:(image|video)\//i.test(ref)) return ref;
  return undefined;
}

/**
 * Kayıtlara paylaşım snapshot'ındaki hedef medyayı ekler. Yalnız bu sayfanın
 * paylaşımları okunur ve yalnız hedef medyalar toplu imzalanır; bozuk veya
 * eski snapshot "unavailable" önizlemeye düşer.
 */
export async function attachPreviews(records: FeedbackCenterRecord[], driver: FeedbackCenterDriver, now: Date): Promise<FeedbackCenterItem[]> {
  const tokens = [...new Set(records.map((record) => record.shareToken))];
  let snapshots = new Map<string, FeedbackSnapshotRow>();
  try {
    snapshots = tokens.length ? await driver.snapshots(tokens) : snapshots;
  } catch (error) {
    console.warn("[feedback-center] snapshot okunamadı; önizleme yok", error instanceof Error ? error.message : error);
  }
  const targets = records.map((record) => {
    const row = snapshots.get(record.shareToken);
    return row ? extractSnapshotTarget(row.payload, record.targetType, record.targetId) : { kind: "unavailable" as const };
  });
  const images = new Set<string>();
  const media = new Set<string>();
  for (const target of targets) {
    if (!target.ref?.startsWith("storage:")) continue;
    const path = target.ref.slice("storage:".length);
    if (path.startsWith("media/")) media.add(path);
    else if (path.startsWith("shares/")) images.add(path);
  }
  let signed = new Map<string, string>();
  try {
    signed = images.size || media.size ? await driver.sign({ images: [...images], media: [...media] }) : signed;
  } catch (error) {
    console.warn("[feedback-center] önizleme imzalanamadı", error instanceof Error ? error.message : error);
  }
  return records.map((record, index) => {
    const target = targets[index];
    const url = previewUrl(target.ref, signed);
    const preview: FeedbackPreview =
      target.kind === "grid"
        ? { kind: "grid", cellCount: target.cellCount }
        : target.kind === "unavailable" || !url
          ? { kind: "unavailable" }
          : { kind: target.kind, url, postType: target.postType, caption: target.caption, alt: target.alt };
    const row = snapshots.get(record.shareToken) ?? null;
    return {
      ...record,
      preview,
      share: { token: record.shareToken, createdAt: row?.createdAt ?? null, expiresAt: row?.expiresAt ?? null, status: shareStatus(row, now) },
    };
  });
}

export async function listFeedbackCenter(userId: string, query: FeedbackListQuery, driver: FeedbackCenterDriver, now = new Date()): Promise<FeedbackListResult> {
  const [{ records, hasMore }, unreadCount] = await Promise.all([driver.list(userId, query), driver.countUnread(userId)]);
  return { items: await attachPreviews(records, driver, now), hasMore, nextOffset: query.offset + records.length, unreadCount };
}

export async function getFeedbackCenterDetail(userId: string, id: string, driver: FeedbackCenterDriver, now = new Date()): Promise<FeedbackDetail | null> {
  const record = await driver.get(userId, id);
  if (!record) return null;
  const history = await driver.history(userId, record);
  const ids = [...new Set([record.id, ...history.map((item) => item.id)])];
  const [[item], events] = await Promise.all([attachPreviews([record], driver, now), driver.events(userId, ids)]);
  return { item, history: history.length ? history : [record], events };
}

export async function handleWorkflowUpdate(userId: string, id: string, body: unknown, driver: FeedbackCenterDriver): Promise<Result> {
  const status = parseWorkflowStatus(typeof body === "object" && body !== null ? (body as Record<string, unknown>).workflowStatus : undefined);
  if (!status) return { status: 400, body: { error: "Geçersiz iş akışı durumu.", code: "WORKFLOW_INVALID" } };
  const updated = await driver.setWorkflow(userId, id, status);
  if (!updated) return { status: 404, body: { error: "Geri dönüş bulunamadı.", code: "FEEDBACK_NOT_FOUND" } };
  return { status: 200, body: { record: updated } };
}

export async function handleMarkRead(userId: string, body: unknown, driver: FeedbackCenterDriver): Promise<Result> {
  const raw = typeof body === "object" && body !== null ? (body as Record<string, unknown>).ids : undefined;
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 200 || !raw.every((id) => typeof id === "string" && id.length <= 64)) {
    return { status: 400, body: { error: "Geçersiz istek.", code: "READ_INVALID" } };
  }
  const updated = await driver.markRead(userId, raw as string[]);
  return { status: 200, body: { ids: updated, unreadCount: await driver.countUnread(userId) } };
}

/**
 * Bildirim özeti (Faz 5): okunmamış sayısı + son birkaç kayıt. Medya
 * imzalanmaz ve snapshot okunmaz; her yoklamada hafif kalır.
 */
export async function getNotificationSummary(userId: string, limitParam: string | null, driver: FeedbackCenterDriver): Promise<FeedbackNotificationSummary> {
  const parsed = Number(limitParam ?? NOTIFICATION_LIMIT);
  const limit = Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, MAX_NOTIFICATION_LIMIT) : NOTIFICATION_LIMIT;
  const [count, records] = await Promise.all([driver.countUnread(userId), driver.recent(userId, limit)]);
  return { count, items: records.map(toNotificationItem) };
}

/** Açık kullanıcı eylemi: yalnız kendi okunmamışları. */
export async function handleMarkAllRead(userId: string, driver: FeedbackCenterDriver): Promise<Result> {
  const updated = await driver.markAllRead(userId);
  return { status: 200, body: { updated, unreadCount: await driver.countUnread(userId) } };
}

/** Bellek içi sürücü: testler ve geliştirme fixture'ı için. */
export class InMemoryFeedbackCenterDriver implements FeedbackCenterDriver {
  readonly events_: Array<FeedbackWorkflowEvent & { userId: string }> = [];

  constructor(
    readonly records: Array<FeedbackCenterRecord & { userId: string | null }>,
    readonly snapshotRows: Map<string, FeedbackSnapshotRow> = new Map(),
    private readonly now: () => Date = () => new Date(),
  ) {}

  private own(userId: string) {
    return this.records.filter((record) => record.userId === userId);
  }

  private strip(record: FeedbackCenterRecord & { userId: string | null }): FeedbackCenterRecord {
    const { userId: _userId, ...rest } = record;
    return { ...rest };
  }

  async list(userId: string, query: FeedbackListQuery) {
    const matches = sortFeedbackRecords(this.own(userId).filter((record) => matchesFeedbackListQuery(record, query)), query.order);
    const page = matches.slice(query.offset, query.offset + query.limit);
    return { records: page.map((record) => this.strip(record)), hasMore: matches.length > query.offset + query.limit };
  }

  async countUnread(userId: string) {
    return this.own(userId).filter((record) => !record.readAt).length;
  }

  async get(userId: string, id: string) {
    const record = this.own(userId).find((item) => item.id === id);
    return record ? this.strip(record) : null;
  }

  async history(userId: string, record: FeedbackCenterRecord) {
    return sortFeedbackRecords(this.own(userId).filter((item) => isSameFeedbackTarget(item, record)), "asc").slice(0, 200).map((item) => this.strip(item));
  }

  async events(userId: string, feedbackIds: string[]) {
    // Kararlı sıralama: aynı andaki olaylarda ekleme sırası korunur.
    return this.events_
      .filter((event) => event.userId === userId && feedbackIds.includes(event.feedbackId))
      .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
      .map(({ userId: _userId, ...event }) => event);
  }

  async snapshots(tokens: string[]) {
    return new Map([...this.snapshotRows].filter(([token]) => tokens.includes(token)));
  }

  async sign(paths: { images: string[]; media: string[] }) {
    return new Map([...paths.images.map((path) => [path, `https://signed.test/${path}`] as const), ...paths.media.map((path) => [path, `https://signed-media.test/${path}`] as const)]);
  }

  async setWorkflow(userId: string, id: string, status: WorkflowStatus) {
    const record = this.own(userId).find((item) => item.id === id);
    if (!record) return null;
    const at = this.now().toISOString();
    record.workflowStatus = status;
    record.workflowUpdatedAt = at;
    record.readAt ??= at;
    this.events_.push({ id: crypto.randomUUID(), feedbackId: id, userId, status, createdAt: at });
    return this.strip(record);
  }

  async recent(userId: string, limit: number) {
    return sortFeedbackRecords(this.own(userId), "desc").slice(0, limit).map((record) => this.strip(record));
  }

  async markAllRead(userId: string) {
    const at = this.now().toISOString();
    let updated = 0;
    for (const record of this.own(userId)) {
      if (!record.readAt) {
        record.readAt = at;
        updated += 1;
      }
    }
    return updated;
  }

  async markRead(userId: string, ids: string[]) {
    const at = this.now().toISOString();
    const updated: string[] = [];
    for (const record of this.own(userId)) {
      if (ids.includes(record.id) && !record.readAt) {
        record.readAt = at;
        updated.push(record.id);
      }
    }
    return updated;
  }
}
