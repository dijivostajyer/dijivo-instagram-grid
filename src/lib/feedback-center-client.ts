"use client";

import { withBasePath } from "./base-path";
import {
  feedbackListQueryToParams,
  type FeedbackCenterRecord,
  type FeedbackDetail,
  type FeedbackListQuery,
  type FeedbackListResult,
  type WorkflowStatus,
} from "./feedback-center";
import type { FeedbackNotificationSummary } from "./feedback-notifications";
import { getSupabaseBrowserClient } from "./supabase-browser";

/** Geri Dönüşler ekranının veri kaynağı (HTTP veya test/fixture). */
export interface FeedbackCenterSource {
  list(query: FeedbackListQuery): Promise<FeedbackListResult>;
  detail(id: string): Promise<FeedbackDetail>;
  setWorkflow(id: string, status: WorkflowStatus): Promise<FeedbackCenterRecord>;
  markRead(ids: string[]): Promise<{ ids: string[]; unreadCount: number }>;
  /** Bildirimler (Faz 5): hafif özet, medya yok. */
  notifications(): Promise<FeedbackNotificationSummary>;
  markAllRead(): Promise<{ updated: number; unreadCount: number }>;
}

async function authHeaders(): Promise<HeadersInit> {
  const client = getSupabaseBrowserClient();
  const { data } = (await client?.auth.getSession()) ?? { data: { session: null } };
  const token = data.session?.access_token;
  if (!token) throw new Error("Oturum doğrulanamadı. Lütfen tekrar giriş yapın.");
  return { Authorization: `Bearer ${token}` };
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(withBasePath(path), {
      ...init,
      headers: { ...(init.body ? { "Content-Type": "application/json" } : {}), ...(await authHeaders()), ...init.headers },
    });
  } catch {
    throw new Error("Bağlantı kurulamadı. İnternet bağlantınızı kontrol edin.");
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = typeof body === "object" && body !== null && typeof (body as { error?: unknown }).error === "string" ? (body as { error: string }).error : "İşlem tamamlanamadı.";
    throw new Error(message);
  }
  return body as T;
}

/** Oturumdaki kullanıcının token'ıyla `/api/feedback` uç noktalarını kullanır. */
export function createHttpFeedbackCenterSource(): FeedbackCenterSource {
  return {
    list: (query) => request<FeedbackListResult>(`/api/feedback?${feedbackListQueryToParams(query).toString()}`),
    detail: (id) => request<FeedbackDetail>(`/api/feedback/${encodeURIComponent(id)}`),
    setWorkflow: async (id, status) =>
      (await request<{ record: FeedbackCenterRecord }>(`/api/feedback/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ workflowStatus: status }) })).record,
    markRead: (ids) => request<{ ids: string[]; unreadCount: number }>("/api/feedback/read", { method: "POST", body: JSON.stringify({ ids }) }),
    notifications: () => request<FeedbackNotificationSummary>("/api/feedback/unread"),
    markAllRead: () => request<{ updated: number; unreadCount: number }>("/api/feedback/read-all", { method: "POST", body: "{}" }),
  };
}
