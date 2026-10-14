"use client";

import { withBasePath } from "../base-path";
import { getSupabaseBrowserClient } from "../supabase-browser";
import type {
  BackupDetails,
  BackupJobView,
  BackupOverview,
  BackupSettingsPatch,
  BackupSettingsView,
  BackupValidationResult,
} from "./shared";

/** Sunucunun döndürdüğü güvenli hata; cooldown için `retryAt` taşır. */
export class BackupRequestError extends Error {
  constructor(message: string, readonly status: number, readonly retryAt: string | null = null) {
    super(message);
  }
}

/** Yedekleme ekranının veri kaynağı (HTTP veya test/fixture). */
export interface BackupCenterSource {
  overview(): Promise<BackupOverview>;
  startBackup(): Promise<BackupJobView>;
  updateSettings(patch: BackupSettingsPatch): Promise<BackupSettingsView>;
  details(id: string): Promise<BackupDetails>;
  validate(id: string): Promise<BackupValidationResult>;
  restore(id: string): Promise<BackupJobView>;
  remove(id: string): Promise<void>;
  download(id: string): Promise<{ blob: Blob; fileName: string }>;
}

async function authHeaders(): Promise<Record<string, string>> {
  const client = getSupabaseBrowserClient();
  const { data } = (await client?.auth.getSession()) ?? { data: { session: null } };
  const token = data.session?.access_token;
  if (!token) throw new BackupRequestError("Oturum doğrulanamadı. Lütfen tekrar giriş yapın.", 401);
  return { Authorization: `Bearer ${token}` };
}

async function send(path: string, init: RequestInit = {}): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(withBasePath(path), {
      ...init,
      cache: "no-store",
      headers: { ...(init.body ? { "Content-Type": "application/json" } : {}), ...(await authHeaders()), ...init.headers },
    });
  } catch {
    throw new BackupRequestError("Bağlantı kurulamadı. İnternet bağlantınızı kontrol edin.", 0);
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: unknown; retryAt?: unknown } | null;
    const message = typeof body?.error === "string" ? body.error : "İşlem tamamlanamadı.";
    throw new BackupRequestError(message, response.status, typeof body?.retryAt === "string" ? body.retryAt : null);
  }
  return response;
}

const json = async <T>(path: string, init?: RequestInit) => (await (await send(path, init)).json()) as T;
const confirmBody = JSON.stringify({ confirm: true });

/** Oturumdaki kullanıcının token'ıyla `/api/backups` uç noktalarını kullanır. */
export function createHttpBackupSource(): BackupCenterSource {
  return {
    overview: () => json<BackupOverview>("/api/backups"),
    startBackup: async () => (await json<{ job: BackupJobView }>("/api/backups", { method: "POST", body: "{}" })).job,
    updateSettings: async (patch) => (await json<{ settings: BackupSettingsView }>("/api/backups/settings", { method: "PATCH", body: JSON.stringify(patch) })).settings,
    details: (id) => json<BackupDetails>(`/api/backups/${encodeURIComponent(id)}`),
    validate: (id) => json<BackupValidationResult>(`/api/backups/${encodeURIComponent(id)}/validate`, { method: "POST", body: "{}" }),
    restore: async (id) => (await json<{ job: BackupJobView }>(`/api/backups/${encodeURIComponent(id)}/restore`, { method: "POST", body: confirmBody })).job,
    remove: async (id) => {
      await send(`/api/backups/${encodeURIComponent(id)}`, { method: "DELETE", body: confirmBody });
    },
    download: async (id) => {
      const response = await send(`/api/backups/${encodeURIComponent(id)}/download`);
      const disposition = response.headers.get("content-disposition") ?? "";
      const fileName = /filename="([^"]+)"/.exec(disposition)?.[1] ?? "yedek.zip";
      return { blob: await response.blob(), fileName };
    },
  };
}
