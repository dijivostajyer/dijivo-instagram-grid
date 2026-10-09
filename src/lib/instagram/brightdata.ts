import type {
  InstagramHighlight,
  InstagramPost,
  InstagramProfile,
  InstagramProvider,
  InstagramProviderResult,
} from "./types";

const API_BASE = "https://api.brightdata.com/datasets/v3";
const DEFAULT_TIMEOUT_MS = 65_000;
const DEFAULT_POLL_ATTEMPTS = 6;
const DEFAULT_POLL_DELAY_MS = 2_000;

export class InstagramProviderError extends Error {
  constructor(public readonly userMessage: string) {
    super(userMessage);
    this.name = "InstagramProviderError";
  }
}

type FetchLike = typeof fetch;
type RecordValue = Record<string, unknown>;

export interface BrightDataProviderOptions {
  apiKey: string;
  datasetId: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  pollAttempts?: number;
  pollDelayMs?: number;
  wait?: (milliseconds: number) => Promise<void>;
}

export type BrightDataImportState =
  | { status: "preparing" }
  | { status: "ready"; result: InstagramProviderResult };

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function bool(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function number(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase().replace(/,/g, "");
  const match = /^(\d+(?:\.\d+)?)\s*([km])?$/.exec(normalized);
  if (!match) return undefined;
  const multiplier = match[2] === "k" ? 1_000 : match[2] === "m" ? 1_000_000 : 1;
  const parsed = Number(match[1]) * multiplier;
  return Number.isFinite(parsed) ? parsed : undefined;
}

function url(...values: unknown[]): string | undefined {
  for (const value of values) {
    const candidate = text(value);
    if (!candidate) continue;
    try {
      const parsed = new URL(candidate);
      if (parsed.protocol === "https:" || parsed.protocol === "http:") return parsed.toString();
    } catch {
      // Provider'dan gelen geçersiz URL'ler yalnız atlanır.
    }
  }
  return undefined;
}

function postType(value: unknown): InstagramPost["type"] {
  const normalized = text(value)?.toLowerCase() ?? "";
  if (normalized.includes("reel") || normalized.includes("video")) return "reel";
  if (normalized.includes("carousel") || normalized.includes("sidecar") || normalized.includes("album")) return "carousel";
  if (normalized.includes("image") || normalized.includes("photo")) return "post";
  return "unknown";
}

function normalizePosts(value: unknown): InstagramPost[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, index) => {
    if (!isRecord(item)) return [];
    const thumbnailUrl = url(item.thumbnail_url, item.thumbnail, item.display_url, item.image_url, item.media_url, item.url);
    const mediaUrl = url(item.media_url, item.video_url, item.display_url, item.image_url);
    if (!thumbnailUrl && !mediaUrl) return [];
    const id = text(item.id) ?? text(item.pk) ?? text(item.shortcode) ?? text(item.code) ?? `brightdata-post-${index}`;
    return [{
      id,
      type: postType(item.content_type ?? item.type ?? item.media_type),
      thumbnailUrl: thumbnailUrl ?? mediaUrl,
      mediaUrl,
      caption: text(item.caption ?? item.description),
      postedAt: text(item.datetime ?? item.timestamp ?? item.taken_at),
    }];
  });
}

function normalizeHighlights(value: unknown): InstagramHighlight[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, index) => {
    if (!isRecord(item)) return [];
    const title = text(item.title ?? item.name);
    if (!title) return [];
    return [{
      id: text(item.id) ?? text(item.pk) ?? text(item.highlight_url) ?? `brightdata-highlight-${index}`,
      title,
      coverUrl: url(item.cover_url, item.cover, item.thumbnail_url, item.thumbnail),
    }];
  });
}

function extractRecords(value: unknown): RecordValue[] {
  if (Array.isArray(value)) return value.filter(isRecord);
  if (!isRecord(value)) return [];
  for (const key of ["records", "data", "results", "items"]) {
    if (Array.isArray(value[key])) return value[key].filter(isRecord);
  }
  if (isRecord(value.profile)) return [value.profile];
  const looksLikeProfile = ["account", "full_name", "profile_name", "profile_url", "posts", "highlights"]
    .some((key) => key in value);
  return looksLikeProfile ? [value] : [];
}

function snapshotId(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  return text(value.snapshot_id) ?? text(value.snapshotId) ?? text(value.id);
}

function errorForStatus(status: number): InstagramProviderError {
  if (status === 401 || status === 403) return new InstagramProviderError("Instagram veri sağlayıcısı yetkilendirmesi başarısız oldu.");
  if (status === 404) return new InstagramProviderError("Instagram profili bulunamadı.");
  if (status === 429) return new InstagramProviderError("Instagram verileri için geçici istek sınırına ulaşıldı. Lütfen biraz sonra tekrar deneyin.");
  return new InstagramProviderError("Instagram bilgileri şu anda alınamıyor. Lütfen tekrar deneyin.");
}

export class BrightDataInstagramProvider implements InstagramProvider {
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;
  private readonly pollAttempts: number;
  private readonly pollDelayMs: number;
  private readonly wait: (milliseconds: number) => Promise<void>;

  constructor(private readonly options: BrightDataProviderOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.pollAttempts = options.pollAttempts ?? DEFAULT_POLL_ATTEMPTS;
    this.pollDelayMs = options.pollDelayMs ?? DEFAULT_POLL_DELAY_MS;
    this.wait = options.wait ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  }

  async fetchProfile(username: string): Promise<InstagramProviderResult> {
    const records = await this.collectRecords(username);
    const record = records[0];
    if (!record) throw new InstagramProviderError("Instagram profili bulunamadı.");
    return this.toResult(record, username);
  }

  /** Uzun süren Bright Data işi için snapshot başlatır; snapshot kimliği yalnız server'da saklanır. */
  async startProfileImport(username: string): Promise<string> {
    const endpoint = new URL(`${API_BASE}/trigger`);
    endpoint.searchParams.set("dataset_id", this.options.datasetId);
    endpoint.searchParams.set("notify", "false");
    endpoint.searchParams.set("include_errors", "true");
    const response = await this.request(endpoint.toString(), {
      method: "POST",
      headers: this.headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({ input: [{ url: `https://www.instagram.com/${encodeURIComponent(username)}/` }], limit_per_input: null }),
    });
    const body = await this.json(response);
    if (!response.ok) throw errorForStatus(response.status);
    const id = snapshotId(body);
    if (!id) throw new InstagramProviderError("Instagram bilgileri şu anda alınamıyor. Lütfen tekrar deneyin.");
    return id;
  }

  /** Tek progress kontrolü yapar; hazır olduğunda yalnız normalize edilmiş sonucu döndürür. */
  async getProfileImport(snapshot: string, username: string): Promise<BrightDataImportState> {
    const progress = await this.request(`${API_BASE}/progress/${encodeURIComponent(snapshot)}`, { headers: this.headers() });
    const progressBody = await this.json(progress);
    if (!progress.ok) throw errorForStatus(progress.status);
    const status = isRecord(progressBody) ? text(progressBody.status)?.toLowerCase() : undefined;
    if (status === "failed") throw new InstagramProviderError("Instagram bilgileri şu anda alınamıyor. Lütfen tekrar deneyin.");
    if (status !== "ready") return { status: "preparing" };
    const records = await this.downloadSnapshot(snapshot);
    const record = records[0];
    if (!record) throw new InstagramProviderError("Instagram profili bulunamadı.");
    return { status: "ready", result: this.toResult(record, username) };
  }

  private toResult(record: RecordValue, username: string): InstagramProviderResult {
    const isPrivate = bool(record.is_private) === true;
    const profile: InstagramProfile = {
      username: text(record.account) ?? username,
      displayName: text(record.full_name) ?? text(record.profile_name),
      biography: text(record.biography),
      profileImageUrl: url(record.profile_image_link),
      followersCount: number(record.followers),
      followingCount: number(record.following),
      postsCount: number(record.posts_count),
      isPrivate,
      isVerified: bool(record.is_verified),
      recentPosts: normalizePosts(record.posts),
      highlights: normalizeHighlights(record.highlights),
    };
    return {
      ok: true,
      profile,
      warnings: isPrivate
        ? ["Bu hesap gizli olduğu için gönderiler veya öne çıkanlar alınamayabilir."]
        : undefined,
    };
  }

  /** Profiles dataseti gönderileri aynı kayıtla döndürür; ikinci ücretli istek yapılmaz. */
  async fetchRecentPosts(): Promise<InstagramPost[]> {
    return [];
  }

  private async collectRecords(username: string): Promise<RecordValue[]> {
    const endpoint = new URL(`${API_BASE}/scrape`);
    endpoint.searchParams.set("dataset_id", this.options.datasetId);
    endpoint.searchParams.set("notify", "false");
    endpoint.searchParams.set("include_errors", "true");
    const response = await this.request(endpoint.toString(), {
      method: "POST",
      headers: this.headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({ input: [{ url: `https://www.instagram.com/${encodeURIComponent(username)}/` }], limit_per_input: null }),
    });
    const body = await this.json(response);
    if (response.status === 202) {
      const id = snapshotId(body);
      if (!id) throw new InstagramProviderError("Instagram bilgileri şu anda alınamıyor. Lütfen tekrar deneyin.");
      return this.pollSnapshot(id);
    }
    if (!response.ok) throw errorForStatus(response.status);
    const records = extractRecords(body);
    if (!records.length) throw new InstagramProviderError("Instagram profili bulunamadı.");
    return records;
  }

  private async pollSnapshot(id: string): Promise<RecordValue[]> {
    for (let attempt = 0; attempt < this.pollAttempts; attempt += 1) {
      if (attempt > 0) await this.wait(this.pollDelayMs);
      const progress = await this.request(`${API_BASE}/progress/${encodeURIComponent(id)}`, { headers: this.headers() });
      const progressBody = await this.json(progress);
      if (!progress.ok) throw errorForStatus(progress.status);
      const status = isRecord(progressBody) ? text(progressBody.status)?.toLowerCase() : undefined;
      if (status === "failed") throw new InstagramProviderError("Instagram bilgileri şu anda alınamıyor. Lütfen tekrar deneyin.");
      if (status !== "ready") continue;
      const records = await this.downloadSnapshot(id);
      if (!records.length) throw new InstagramProviderError("Instagram profili bulunamadı.");
      return records;
    }
    throw new InstagramProviderError("Instagram bilgileri şu anda alınamıyor. Lütfen tekrar deneyin.");
  }

  private async downloadSnapshot(id: string): Promise<RecordValue[]> {
    const result = await this.request(`${API_BASE}/snapshot/${encodeURIComponent(id)}?format=json`, { headers: this.headers() });
    const resultBody = await this.json(result);
    if (!result.ok) throw errorForStatus(result.status);
    return extractRecords(resultBody);
  }

  private headers(extra: Record<string, string> = {}) {
    return { Authorization: `Bearer ${this.options.apiKey}`, ...extra };
  }

  private async request(input: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetchImpl(input, { ...init, signal: controller.signal });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new InstagramProviderError("Instagram bilgileri şu anda alınamıyor. Lütfen tekrar deneyin.");
      }
      throw new InstagramProviderError("Instagram bilgileri şu anda alınamıyor. Lütfen tekrar deneyin.");
    } finally {
      clearTimeout(timeout);
    }
  }

  private async json(response: Response): Promise<unknown> {
    try {
      return await response.json();
    } catch {
      return null;
    }
  }
}
