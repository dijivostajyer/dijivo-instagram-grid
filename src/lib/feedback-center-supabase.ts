import { createClient } from "@supabase/supabase-js";

import type { FeedbackCenterRecord, FeedbackListQuery, FeedbackWorkflowEvent, WorkflowStatus } from "./feedback-center";
import type { FeedbackCenterDriver, FeedbackSnapshotRow } from "./feedback-center-server";
import { getShareStorageConfig } from "./share-config";

const COLUMNS = "id,share_token,brand_id,project_id,target_type,target_id,action,message,client_name,created_at,workflow_status,workflow_updated_at,read_at";

type Row = {
  id: string;
  share_token: string;
  brand_id: string | null;
  project_id: string | null;
  target_type: FeedbackCenterRecord["targetType"];
  target_id: string | null;
  action: FeedbackCenterRecord["action"];
  message: string | null;
  client_name: string;
  created_at: string;
  workflow_status: WorkflowStatus | null;
  workflow_updated_at: string | null;
  read_at: string | null;
};

function fromRow(row: Row): FeedbackCenterRecord {
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
    workflowStatus: row.workflow_status ?? "new",
    workflowUpdatedAt: row.workflow_updated_at,
    readAt: row.read_at,
  };
}

function fail(step: string, error: { message: string; code?: string } | null): never {
  console.error("[feedback-center]", { step, errorCode: error?.code, error: error?.message });
  throw new Error(`Geri dönüşler okunamadı (${step}).`);
}

/** PostgREST `in.(…)` için çift tırnaklı değer listesi (kimlikler önceden doğrulanır). */
function quotedList(values: string[]): string {
  return values.map((value) => `"${value.replace(/"/g, "")}"`).join(",");
}

/**
 * Supabase sürücüsü (yalnız sunucu, service role). RLS'i service role
 * atladığı için her sorgu açıkça `user_id = userId` ile sınırlandırılır.
 */
export class SupabaseFeedbackCenterDriver implements FeedbackCenterDriver {
  private readonly client;
  private readonly imageBucket: string;
  private readonly mediaBucket: string;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    const config = getShareStorageConfig(env);
    this.client = createClient(config.url, config.secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
    this.imageBucket = config.bucket;
    this.mediaBucket = config.mediaBucket;
  }

  async list(userId: string, query: FeedbackListQuery) {
    let request = this.client.from("share_feedback").select(COLUMNS).eq("user_id", userId);
    if (query.brandId) request = request.eq("brand_id", query.brandId);
    if (query.projectIds?.length) request = request.in("project_id", query.projectIds);
    if (query.targetType) request = request.eq("target_type", query.targetType);
    if (query.action) request = request.eq("action", query.action);
    if (query.workflowStatus) request = request.eq("workflow_status", query.workflowStatus);
    if (query.unreadOnly) request = request.is("read_at", null);
    if (query.q) {
      // q, sanitizeFeedbackSearch ile sorgu dili karakterlerinden arındırılmıştır.
      const conditions = [`client_name.ilike.*${query.q}*`, `message.ilike.*${query.q}*`];
      if (query.qBrandIds?.length) conditions.push(`brand_id.in.(${quotedList(query.qBrandIds)})`);
      request = request.or(conditions.join(","));
    }
    const ascending = query.order === "asc";
    const { data, error } = await request
      .order("created_at", { ascending })
      .order("id", { ascending })
      .range(query.offset, query.offset + query.limit);
    if (error) fail("list", error);
    const rows = (data ?? []) as Row[];
    return { records: rows.slice(0, query.limit).map(fromRow), hasMore: rows.length > query.limit };
  }

  async countUnread(userId: string) {
    const { count, error } = await this.client
      .from("share_feedback").select("id", { count: "exact", head: true })
      .eq("user_id", userId).is("read_at", null);
    if (error) fail("count_unread", error);
    return count ?? 0;
  }

  async get(userId: string, id: string) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    const { data, error } = await this.client.from("share_feedback").select(COLUMNS).eq("id", id).eq("user_id", userId).maybeSingle();
    if (error) fail("get", error);
    return data ? fromRow(data as Row) : null;
  }

  async history(userId: string, record: FeedbackCenterRecord) {
    let request = this.client.from("share_feedback").select(COLUMNS).eq("user_id", userId).eq("target_type", record.targetType);
    if (record.targetType !== "grid") request = request.eq("target_id", record.targetId ?? "");
    else if (record.projectId) request = request.eq("project_id", record.projectId);
    else request = request.eq("share_token", record.shareToken);
    const { data, error } = await request.order("created_at", { ascending: true }).order("id", { ascending: true }).limit(200);
    if (error) fail("history", error);
    return ((data ?? []) as Row[]).map(fromRow);
  }

  async events(userId: string, feedbackIds: string[]) {
    if (!feedbackIds.length) return [];
    const { data, error } = await this.client
      .from("share_feedback_workflow_events").select("id,feedback_id,status,created_at")
      .eq("user_id", userId).in("feedback_id", feedbackIds)
      .order("created_at", { ascending: true }).limit(500);
    if (error) fail("events", error);
    return ((data ?? []) as Array<{ id: string; feedback_id: string; status: WorkflowStatus; created_at: string }>).map(
      (row): FeedbackWorkflowEvent => ({ id: row.id, feedbackId: row.feedback_id, status: row.status, createdAt: row.created_at }),
    );
  }

  async snapshots(tokens: string[]) {
    const { data, error } = await this.client
      .from("share_snapshots").select("token,payload,created_at,expires_at,revoked_at").in("token", tokens);
    if (error) fail("snapshots", error);
    const rows = (data ?? []) as Array<{ token: string; payload: unknown; created_at: string | null; expires_at: string | null; revoked_at: string | null }>;
    return new Map(rows.map((row): [string, FeedbackSnapshotRow] => [row.token, { token: row.token, payload: row.payload, createdAt: row.created_at, expiresAt: row.expires_at, revokedAt: row.revoked_at }]));
  }

  async sign(paths: { images: string[]; media: string[] }) {
    const signed = new Map<string, string>();
    const batch = async (bucket: string, list: string[]) => {
      if (!list.length) return;
      const { data, error } = await this.client.storage.from(bucket).createSignedUrls(list, 3600);
      if (error) {
        console.warn("[feedback-center] imzalama başarısız", { bucket, error: error.message });
        return;
      }
      for (const item of data ?? []) if (item.path && item.signedUrl) signed.set(item.path, item.signedUrl);
    };
    await Promise.all([batch(this.imageBucket, paths.images), batch(this.mediaBucket, paths.media)]);
    return signed;
  }

  async setWorkflow(userId: string, id: string, status: WorkflowStatus) {
    const existing = await this.get(userId, id);
    if (!existing) return null;
    const at = new Date().toISOString();
    const { data, error } = await this.client
      .from("share_feedback")
      .update({ workflow_status: status, workflow_updated_at: at, ...(existing.readAt ? {} : { read_at: at }) })
      .eq("id", id).eq("user_id", userId)
      .select(COLUMNS).maybeSingle();
    if (error) fail("set_workflow", error);
    if (!data) return null;
    const { error: eventError } = await this.client.from("share_feedback_workflow_events").insert({ feedback_id: id, user_id: userId, status });
    if (eventError) fail("workflow_event", eventError);
    return fromRow(data as Row);
  }

  async recent(userId: string, limit: number) {
    const { data, error } = await this.client
      .from("share_feedback").select(COLUMNS)
      .eq("user_id", userId)
      .order("created_at", { ascending: false }).order("id", { ascending: false })
      .limit(limit);
    if (error) fail("recent", error);
    return ((data ?? []) as Row[]).map(fromRow);
  }

  async markAllRead(userId: string) {
    // Yalnız kullanıcının okunmamışları; created_at ve müşteri alanları değişmez.
    const { data, error } = await this.client
      .from("share_feedback").update({ read_at: new Date().toISOString() })
      .eq("user_id", userId).is("read_at", null)
      .select("id");
    if (error) fail("mark_all_read", error);
    return (data ?? []).length;
  }

  async markRead(userId: string, ids: string[]) {
    const valid = ids.filter((id) => /^[0-9a-f-]{36}$/i.test(id));
    if (!valid.length) return [];
    const { data, error } = await this.client
      .from("share_feedback").update({ read_at: new Date().toISOString() })
      .eq("user_id", userId).in("id", valid).is("read_at", null)
      .select("id");
    if (error) fail("mark_read", error);
    return ((data ?? []) as Array<{ id: string }>).map((row) => row.id);
  }
}
