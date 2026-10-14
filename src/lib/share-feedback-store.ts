import { createClient } from "@supabase/supabase-js";

import type { FeedbackRecord, FeedbackRequest } from "./share-feedback";
import { shouldUseSupabase } from "./share-store";

/** Sunucunun eklediği alanlarla birlikte yazılacak olay. */
export interface NewFeedbackRecord extends FeedbackRequest {
  shareToken: string;
  brandId: string | null;
  projectId: string | null;
}

/**
 * Geri bildirim olay günlüğü. Yalnız ekleme ve okuma vardır; güncelleme /
 * silme yoktur (audit trail). `createdAt` depo tarafından üretilir.
 */
export interface ShareFeedbackStore {
  add(record: NewFeedbackRecord): Promise<FeedbackRecord>;
  /** Paylaşımın tüm olayları, eskiden yeniye. */
  list(shareToken: string): Promise<FeedbackRecord[]>;
  /** Spam koruması: verilen andan sonra bu paylaşıma yazılan olay sayısı. */
  countSince(shareToken: string, since: Date): Promise<number>;
}

export class InMemoryShareFeedbackStore implements ShareFeedbackStore {
  private readonly records: FeedbackRecord[] = [];

  constructor(private readonly now: () => Date = () => new Date()) {}

  async add(record: NewFeedbackRecord): Promise<FeedbackRecord> {
    const stored: FeedbackRecord = { ...record, id: crypto.randomUUID(), createdAt: this.now().toISOString() };
    this.records.push(stored);
    return { ...stored };
  }

  async list(shareToken: string): Promise<FeedbackRecord[]> {
    return this.records.filter((record) => record.shareToken === shareToken).map((record) => ({ ...record }));
  }

  async countSince(shareToken: string, since: Date): Promise<number> {
    return this.records.filter((record) => record.shareToken === shareToken && Date.parse(record.createdAt) >= since.getTime()).length;
  }
}

type FeedbackRow = {
  id: string;
  share_token: string;
  brand_id: string | null;
  project_id: string | null;
  target_type: FeedbackRecord["targetType"];
  target_id: string | null;
  action: FeedbackRecord["action"];
  message: string | null;
  client_name: string;
  created_at: string;
};

function fromRow(row: FeedbackRow): FeedbackRecord {
  return {
    id: row.id,
    shareToken: row.share_token,
    brandId: row.brand_id,
    projectId: row.project_id,
    targetType: row.target_type,
    targetId: row.target_id,
    action: row.action,
    message: row.message,
    clientName: row.client_name,
    createdAt: row.created_at,
  };
}

const FEEDBACK_COLUMNS = "id,share_token,brand_id,project_id,target_type,target_id,action,message,client_name,created_at";

/**
 * Supabase adapter (yalnız sunucu, service role). Tablo RLS ile kapalıdır;
 * public istemci doğrudan yazamaz. Sahiplik (user_id) markadan çözülür,
 * böylece ajans geri bildirimleri kendi oturumuyla okuyabilir.
 */
export class SupabaseShareFeedbackStore implements ShareFeedbackStore {
  private readonly client;

  constructor(url: string, secretKey: string) {
    this.client = createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
  }

  private async ownerOf(brandId: string | null): Promise<string | null> {
    if (!brandId) return null;
    const { data, error } = await this.client.from("workspace_brands").select("user_id").eq("id", brandId).maybeSingle();
    if (error) {
      console.warn("[share-feedback] marka sahibi okunamadı", { error: error.message });
      return null;
    }
    return typeof data?.user_id === "string" ? data.user_id : null;
  }

  async add(record: NewFeedbackRecord): Promise<FeedbackRecord> {
    // created_at gönderilmez: veritabanı now() ile üretir.
    const { data, error } = await this.client
      .from("share_feedback")
      .insert({
        share_token: record.shareToken,
        user_id: await this.ownerOf(record.brandId),
        brand_id: record.brandId,
        project_id: record.projectId,
        target_type: record.targetType,
        target_id: record.targetId,
        action: record.action,
        message: record.message,
        client_name: record.clientName,
      })
      .select(FEEDBACK_COLUMNS)
      .single();
    if (error || !data) {
      console.error("[share-feedback]", { step: "insert", errorCode: error?.code, error: error?.message });
      throw new Error(`share_feedback yazılamadı: ${error?.message ?? "kayıt dönmedi"}`);
    }
    return fromRow(data as FeedbackRow);
  }

  async list(shareToken: string): Promise<FeedbackRecord[]> {
    const { data, error } = await this.client
      .from("share_feedback")
      .select(FEEDBACK_COLUMNS)
      .eq("share_token", shareToken)
      .order("created_at", { ascending: true })
      .limit(1000);
    if (error) {
      console.error("[share-feedback]", { step: "list", errorCode: error.code, error: error.message });
      throw new Error(`share_feedback okunamadı: ${error.message}`);
    }
    return ((data ?? []) as FeedbackRow[]).map(fromRow);
  }

  async countSince(shareToken: string, since: Date): Promise<number> {
    const { count, error } = await this.client
      .from("share_feedback")
      .select("id", { count: "exact", head: true })
      .eq("share_token", shareToken)
      .gte("created_at", since.toISOString());
    if (error) {
      console.error("[share-feedback]", { step: "count", errorCode: error.code, error: error.message });
      throw new Error(`share_feedback sayılamadı: ${error.message}`);
    }
    return count ?? 0;
  }
}

declare global {
  // eslint-disable-next-line no-var
  var dijivoShareFeedbackStore: ShareFeedbackStore | undefined;
}

/** Share store ile aynı seçim: Supabase varsa o, yoksa yalnız geliştirmede bellek. */
export function getShareFeedbackStore(env: NodeJS.ProcessEnv = process.env): ShareFeedbackStore {
  if (shouldUseSupabase(env)) return new SupabaseShareFeedbackStore(env.SUPABASE_URL as string, env.SUPABASE_SECRET_KEY as string);
  if (env.NODE_ENV === "production") throw new Error("Supabase geri bildirim yapılandırması eksik.");
  return globalThis.dijivoShareFeedbackStore ?? (globalThis.dijivoShareFeedbackStore = new InMemoryShareFeedbackStore());
}
