import { timingSafeEqual } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import packageJson from "../../../package.json";
import { authenticateRequest } from "../server-auth";
import { BackupEngine, BackupError } from "./engine";
import { FileSystemBackupStore, resolveBackupDir } from "./files";
import { SupabaseBackupDatabase, SupabaseBackupMetaStore, SupabaseBackupStorage } from "./supabase";

/** Cron secret'ı en az bu uzunlukta olmalı (kısa/tahmin edilebilir değer reddedilir). */
export const MIN_CRON_SECRET_LENGTH = 32;

export function backupBuckets(env: NodeJS.ProcessEnv = process.env): string[] {
  return [
    env.SUPABASE_WORKSPACE_MEDIA_BUCKET?.trim() || "workspace-media",
    env.SUPABASE_SHARE_BUCKET?.trim() || "share-images",
    env.SUPABASE_SHARE_MEDIA_BUCKET?.trim() || "share-media",
  ];
}

function adminClient(env: NodeJS.ProcessEnv) {
  const url = env.SUPABASE_URL?.trim();
  const secret = env.SUPABASE_SECRET_KEY?.trim();
  if (!url || !secret) return null;
  return createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
}

function cronSecret(env: NodeJS.ProcessEnv): string | null {
  const value = env.BACKUP_CRON_SECRET?.trim();
  return value && value.length >= MIN_CRON_SECRET_LENGTH ? value : null;
}

/**
 * Sunucu motoru. BACKUP_DIR geçersizse motor yine oluşur (liste/ayar
 * çalışır) ama yedek alma/geri yükleme 503 ile reddedilir.
 */
export function createBackupEngine(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): BackupEngine | null {
  const client = adminClient(env);
  if (!client) return null;
  const dir = resolveBackupDir(env, cwd);
  return new BackupEngine({
    db: new SupabaseBackupDatabase(client),
    storage: new SupabaseBackupStorage(client),
    meta: new SupabaseBackupMetaStore(client),
    files: dir.ok ? new FileSystemBackupStore(dir.dir) : null,
    storageError: dir.ok ? null : dir.error,
    buckets: backupBuckets(env),
    appVersion: packageJson.version,
    cronConfigured: Boolean(cronSecret(env)),
  });
}

export type BackupOwner = { ok: true; userId: string } | { ok: false; response: NextResponse };

/**
 * Yedekleme yalnız çalışma alanı sahibine (workspace_bootstrap.owner_id)
 * açıktır: oturum doğrulanır (getUser), ardından sahiplik kontrol edilir.
 */
export async function authorizeBackupOwner(request: Request, env: NodeJS.ProcessEnv = process.env): Promise<BackupOwner> {
  const user = await authenticateRequest(request, env);
  if (!user.ok) return { ok: false, response: NextResponse.json({ error: user.error }, { status: user.status }) };
  const client = adminClient(env);
  if (!client) return { ok: false, response: NextResponse.json({ error: "Sunucu Supabase yapılandırması eksik." }, { status: 503 }) };
  const { data, error } = await client.from("workspace_bootstrap").select("owner_id").eq("id", true).maybeSingle();
  if (error) {
    console.error("[backup]", { event: "owner_check_failed", errorCode: error.code, error: error.message });
    return { ok: false, response: NextResponse.json({ error: "Yetki doğrulanamadı." }, { status: 500 }) };
  }
  if (!data?.owner_id || data.owner_id !== user.userId) {
    return { ok: false, response: NextResponse.json({ error: "Yedekleme yalnız çalışma alanı sahibi tarafından yönetilebilir." }, { status: 403 }) };
  }
  return { ok: true, userId: user.userId };
}

/** `Authorization: Bearer <BACKUP_CRON_SECRET>`; sabit zamanlı karşılaştırma. Secret loglanmaz. */
export function verifyCronRequest(request: Request, env: NodeJS.ProcessEnv = process.env): "ok" | "unconfigured" | "denied" {
  const secret = cronSecret(env);
  if (!secret) return "unconfigured";
  const given = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";
  const a = Buffer.from(given, "utf8");
  const b = Buffer.from(secret, "utf8");
  if (a.length !== b.length) {
    timingSafeEqual(b, b);
    return "denied";
  }
  return timingSafeEqual(a, b) ? "ok" : "denied";
}

export const NO_STORE = { "Cache-Control": "no-store" } as const;

export function engineUnavailable(): NextResponse {
  return NextResponse.json({ error: "Sunucu Supabase yapılandırması eksik." }, { status: 503, headers: NO_STORE });
}

/** BackupError → güvenli Türkçe yanıt; diğer hatalar genel mesajla loglanır. */
export function backupErrorResponse(error: unknown, step: string): NextResponse {
  if (error instanceof BackupError) {
    const body: Record<string, unknown> = { error: error.message, code: error.code };
    if (typeof error.extra.retryAt === "string") body.retryAt = error.extra.retryAt;
    if (typeof error.extra.jobId === "string") body.jobId = error.extra.jobId;
    return NextResponse.json(body, { status: error.status, headers: NO_STORE });
  }
  console.error("[backup]", { event: `${step}_error`, error: error instanceof Error ? error.message : "bilinmeyen hata" });
  return NextResponse.json({ error: "İşlem tamamlanamadı. Lütfen tekrar deneyin." }, { status: 500, headers: NO_STORE });
}

/** Arka plan işinin reddini yut (hata zaten iş kaydına ve loga yazıldı). */
export function settleInBackground(promise: Promise<unknown>): void {
  void promise.catch(() => undefined);
}

export async function readConfirmation(request: Request): Promise<boolean> {
  const body = await request.json().catch(() => null);
  return typeof body === "object" && body !== null && (body as { confirm?: unknown }).confirm === true;
}
