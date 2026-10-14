import type { SupabaseClient } from "@supabase/supabase-js";

import type { BackupSettingsPatch } from "./shared";
import type {
  BackupAuditEvent,
  BackupDatabase,
  BackupJobPatch,
  BackupJobRecord,
  BackupMetaStore,
  BackupSettingsRecord,
  BackupStorage,
  DbSnapshot,
  NewBackupJob,
  StoredObject,
  TableRow,
} from "./types";

/**
 * Supabase (service role, yalnız sunucu) port uygulamaları. Hata mesajları
 * Supabase'in döndürdüğü metindir; anahtar/sır içermez.
 */

function fail(step: string, error: { message?: string; code?: string } | null): never {
  throw new Error(`${step}: ${error?.message ?? "bilinmeyen hata"}${error?.code ? ` (${error.code})` : ""}`);
}

export class SupabaseBackupDatabase implements BackupDatabase {
  constructor(private readonly client: SupabaseClient) {}

  async exportSnapshot(): Promise<DbSnapshot> {
    const { data, error } = await this.client.rpc("backup_export_snapshot");
    if (error) fail("backup_export_snapshot", error);
    const value = data as { exported_at?: string; tables?: Record<string, TableRow[]> } | null;
    if (!value?.tables) throw new Error("backup_export_snapshot: boş yanıt");
    return { exportedAt: value.exported_at ?? new Date().toISOString(), tables: value.tables };
  }

  async stageRows(jobId: string, table: string, rows: Array<{ ord: number; row: TableRow }>): Promise<void> {
    const { error } = await this.client
      .from("backup_restore_staging")
      .insert(rows.map((item) => ({ job_id: jobId, table_name: table, ord: item.ord, row: item.row })));
    if (error) fail("backup_restore_staging", error);
  }

  async clearStaging(jobId: string): Promise<void> {
    const { error } = await this.client.from("backup_restore_staging").delete().eq("job_id", jobId);
    if (error) fail("backup_restore_staging_clear", error);
  }

  async applyRestore(jobId: string, expected: Record<string, number>) {
    const { data, error } = await this.client.rpc("backup_apply_restore", { p_job_id: jobId, p_expected: expected });
    if (error) fail("backup_apply_restore", error);
    const value = data as { counts?: Record<string, number>; epoch?: string } | null;
    if (!value?.epoch || !value.counts) throw new Error("backup_apply_restore: boş yanıt");
    return { counts: value.counts, epoch: value.epoch };
  }

  async missingAuthUsers(ids: string[]): Promise<string[]> {
    const missing: string[] = [];
    for (const id of ids) {
      const { data, error } = await this.client.auth.admin.getUserById(id);
      if (data?.user) continue;
      const status = (error as { status?: number } | null)?.status;
      if (error && status !== 404) fail("auth_get_user", error);
      missing.push(id);
    }
    return missing;
  }

  async workspaceOwner(): Promise<string | null> {
    const { data, error } = await this.client.from("workspace_bootstrap").select("owner_id").eq("id", true).maybeSingle();
    if (error) fail("workspace_bootstrap", error);
    return typeof data?.owner_id === "string" ? data.owner_id : null;
  }
}

const EXTENSION_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  mp4: "video/mp4",
  webm: "video/webm",
};

function contentTypeFor(path: string, given: string | null): string | undefined {
  if (given) return given;
  return EXTENSION_TYPES[path.split(".").pop()?.toLowerCase() ?? ""];
}

export class SupabaseBackupStorage implements BackupStorage {
  constructor(private readonly client: SupabaseClient) {}

  /** Klasörleri özyinelemeli ve sayfalı gezer (Storage API klasörleri ayrı öğe döndürür). */
  async list(bucket: string): Promise<StoredObject[]> {
    const objects: StoredObject[] = [];
    const walk = async (prefix: string): Promise<void> => {
      for (let offset = 0; ; offset += 1000) {
        const { data, error } = await this.client.storage.from(bucket).list(prefix, { limit: 1000, offset, sortBy: { column: "name", order: "asc" } });
        if (error) fail(`storage_list:${bucket}`, error);
        const entries = data ?? [];
        for (const entry of entries) {
          const path = prefix ? `${prefix}/${entry.name}` : entry.name;
          if (entry.id) {
            const metadata = (entry.metadata ?? {}) as { size?: number; mimetype?: string };
            objects.push({ path, bytes: Number(metadata.size ?? 0), contentType: metadata.mimetype ?? null });
          } else {
            await walk(path);
          }
        }
        if (entries.length < 1000) break;
      }
    };
    await walk("");
    return objects;
  }

  async download(bucket: string, path: string) {
    const { data, error } = await this.client.storage.from(bucket).download(path);
    if (error || !data) fail(`storage_download:${bucket}`, error);
    return { data: Buffer.from(await data.arrayBuffer()), contentType: data.type || null };
  }

  async upload(bucket: string, path: string, data: Buffer, contentType: string | null): Promise<void> {
    const { error } = await this.client.storage.from(bucket).upload(path, data, { upsert: false, contentType: contentTypeFor(path, contentType) });
    if (error) fail(`storage_upload:${bucket}`, error);
  }

  async remove(bucket: string, paths: string[]): Promise<void> {
    for (let offset = 0; offset < paths.length; offset += 100) {
      const { error } = await this.client.storage.from(bucket).remove(paths.slice(offset, offset + 100));
      if (error) fail(`storage_remove:${bucket}`, error);
    }
  }
}

type SettingsRow = {
  auto_enabled: boolean;
  interval_minutes: number;
  keep_last: number;
  keep_daily_days: number;
  keep_weekly_weeks: number;
  keep_pre_restore_days: number;
  lock_job_id: string | null;
  lock_operation: "backup" | "restore" | null;
  lock_acquired_at: string | null;
  lock_heartbeat_at: string | null;
  cron_last_seen_at: string | null;
  last_unchanged_at: string | null;
  updated_at: string | null;
};

type JobRow = {
  id: string;
  operation: BackupJobRecord["operation"];
  kind: BackupJobRecord["kind"];
  status: BackupJobRecord["status"];
  actor: BackupJobRecord["actor"];
  actor_user_id: string | null;
  file_name: string | null;
  size_bytes: number | string | null;
  db_row_count: number | null;
  media_file_count: number | null;
  summary: BackupJobRecord["summary"] | null;
  source_backup_id: string | null;
  safety_backup_id: string | null;
  error_stage: string | null;
  error_message: string | null;
  started_at: string;
  heartbeat_at: string | null;
  finished_at: string | null;
  deleted_at: string | null;
  deleted_by: string | null;
  deleted_reason: BackupJobRecord["deletedReason"];
};

const JOB_COLUMNS = "id,operation,kind,status,actor,actor_user_id,file_name,size_bytes,db_row_count,media_file_count,summary,source_backup_id,safety_backup_id,error_stage,error_message,started_at,heartbeat_at,finished_at,deleted_at,deleted_by,deleted_reason";

function fromSettings(row: SettingsRow): BackupSettingsRecord {
  return {
    autoEnabled: row.auto_enabled,
    intervalMinutes: row.interval_minutes,
    keepLast: row.keep_last,
    keepDailyDays: row.keep_daily_days,
    keepWeeklyWeeks: row.keep_weekly_weeks,
    keepPreRestoreDays: row.keep_pre_restore_days,
    updatedAt: row.updated_at,
    lockJobId: row.lock_job_id,
    lockOperation: row.lock_operation,
    lockAcquiredAt: row.lock_acquired_at,
    lockHeartbeatAt: row.lock_heartbeat_at,
    cronLastSeenAt: row.cron_last_seen_at,
    lastUnchangedAt: row.last_unchanged_at,
  };
}

function fromJob(row: JobRow): BackupJobRecord {
  return {
    id: row.id,
    operation: row.operation,
    kind: row.kind,
    status: row.status,
    actor: row.actor,
    actorUserId: row.actor_user_id,
    fileName: row.file_name,
    sizeBytes: row.size_bytes === null ? null : Number(row.size_bytes),
    dbRowCount: row.db_row_count,
    mediaFileCount: row.media_file_count,
    summary: row.summary ?? {},
    sourceBackupId: row.source_backup_id,
    safetyBackupId: row.safety_backup_id,
    errorStage: row.error_stage,
    errorMessage: row.error_message,
    startedAt: row.started_at,
    heartbeatAt: row.heartbeat_at,
    finishedAt: row.finished_at,
    deletedAt: row.deleted_at,
    deletedBy: row.deleted_by,
    deletedReason: row.deleted_reason,
  };
}

const JOB_PATCH_COLUMNS: Record<keyof BackupJobPatch, string> = {
  status: "status",
  actorUserId: "actor_user_id",
  fileName: "file_name",
  sizeBytes: "size_bytes",
  dbRowCount: "db_row_count",
  mediaFileCount: "media_file_count",
  summary: "summary",
  sourceBackupId: "source_backup_id",
  safetyBackupId: "safety_backup_id",
  errorStage: "error_stage",
  errorMessage: "error_message",
  heartbeatAt: "heartbeat_at",
  finishedAt: "finished_at",
  deletedAt: "deleted_at",
  deletedBy: "deleted_by",
  deletedReason: "deleted_reason",
};

function toJobPatch(patch: BackupJobPatch): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    const column = JOB_PATCH_COLUMNS[key as keyof BackupJobPatch];
    if (column && value !== undefined) row[column] = value;
  }
  return row;
}

/** PostgREST `or` filtresinde ISO zaman damgası tırnak içinde verilir. */
const quoted = (value: string) => `"${value}"`;

export class SupabaseBackupMetaStore implements BackupMetaStore {
  constructor(private readonly client: SupabaseClient) {}

  async getSettings(): Promise<BackupSettingsRecord> {
    const { data, error } = await this.client.from("backup_settings").select("*").eq("id", true).maybeSingle();
    if (error) fail("backup_settings", error);
    if (data) return fromSettings(data as SettingsRow);
    // Migration satırı oluşturur; yoksa varsayılanla oluşturulur.
    const { data: created, error: insertError } = await this.client.from("backup_settings").upsert({ id: true }, { onConflict: "id", ignoreDuplicates: true }).select("*").maybeSingle();
    if (insertError) fail("backup_settings_init", insertError);
    if (created) return fromSettings(created as SettingsRow);
    const again = await this.client.from("backup_settings").select("*").eq("id", true).single();
    if (again.error) fail("backup_settings", again.error);
    return fromSettings(again.data as SettingsRow);
  }

  async updateSettings(patch: BackupSettingsPatch, userId: string, now: Date): Promise<BackupSettingsRecord> {
    const row: Record<string, unknown> = { updated_at: now.toISOString(), updated_by: userId };
    if (patch.autoEnabled !== undefined) row.auto_enabled = patch.autoEnabled;
    if (patch.intervalMinutes !== undefined) row.interval_minutes = patch.intervalMinutes;
    if (patch.keepLast !== undefined) row.keep_last = patch.keepLast;
    if (patch.keepDailyDays !== undefined) row.keep_daily_days = patch.keepDailyDays;
    if (patch.keepWeeklyWeeks !== undefined) row.keep_weekly_weeks = patch.keepWeeklyWeeks;
    if (patch.keepPreRestoreDays !== undefined) row.keep_pre_restore_days = patch.keepPreRestoreDays;
    await this.getSettings();
    const { data, error } = await this.client.from("backup_settings").update(row).eq("id", true).select("*").single();
    if (error) fail("backup_settings_update", error);
    return fromSettings(data as SettingsRow);
  }

  async acquireLock(lockId: string, operation: "backup" | "restore", now: Date, staleBefore: Date): Promise<boolean> {
    await this.getSettings();
    const iso = now.toISOString();
    const { data, error } = await this.client
      .from("backup_settings")
      .update({ lock_job_id: lockId, lock_operation: operation, lock_acquired_at: iso, lock_heartbeat_at: iso })
      .eq("id", true)
      .or(`lock_job_id.is.null,lock_heartbeat_at.is.null,lock_heartbeat_at.lt.${quoted(staleBefore.toISOString())}`)
      .select("lock_job_id");
    if (error) fail("backup_lock_acquire", error);
    return (data ?? []).length === 1 && data![0].lock_job_id === lockId;
  }

  async heartbeat(lockId: string, now: Date): Promise<boolean> {
    const { data, error } = await this.client
      .from("backup_settings")
      .update({ lock_heartbeat_at: now.toISOString() })
      .eq("id", true)
      .eq("lock_job_id", lockId)
      .select("lock_job_id");
    if (error) fail("backup_lock_heartbeat", error);
    return (data ?? []).length === 1;
  }

  async releaseLock(lockId: string): Promise<void> {
    const { error } = await this.client
      .from("backup_settings")
      .update({ lock_job_id: null, lock_operation: null, lock_acquired_at: null, lock_heartbeat_at: null })
      .eq("id", true)
      .eq("lock_job_id", lockId);
    if (error) fail("backup_lock_release", error);
  }

  async releaseStaleLock(lockId: string, staleBefore: Date): Promise<boolean> {
    const { data, error } = await this.client
      .from("backup_settings")
      .update({ lock_job_id: null, lock_operation: null, lock_acquired_at: null, lock_heartbeat_at: null })
      .eq("id", true)
      .eq("lock_job_id", lockId)
      .or(`lock_heartbeat_at.is.null,lock_heartbeat_at.lt.${quoted(staleBefore.toISOString())}`)
      .select("id");
    if (error) fail("backup_lock_release_stale", error);
    return (data ?? []).length === 1;
  }

  async touchCron(now: Date): Promise<void> {
    await this.getSettings();
    const { error } = await this.client.from("backup_settings").update({ cron_last_seen_at: now.toISOString() }).eq("id", true);
    if (error) fail("backup_cron_seen", error);
  }

  async markUnchanged(now: Date): Promise<void> {
    const { error } = await this.client.from("backup_settings").update({ last_unchanged_at: now.toISOString() }).eq("id", true);
    if (error) fail("backup_mark_unchanged", error);
  }

  async createJob(job: NewBackupJob): Promise<void> {
    const { error } = await this.client.from("backup_jobs").insert({
      id: job.id,
      operation: job.operation,
      kind: job.kind,
      status: "running",
      actor: job.actor,
      actor_user_id: job.actorUserId,
      source_backup_id: job.sourceBackupId ?? null,
      started_at: job.startedAt,
      heartbeat_at: job.startedAt,
    });
    if (error) fail("backup_job_create", error);
  }

  async updateJob(id: string, patch: BackupJobPatch): Promise<void> {
    const { error } = await this.client.from("backup_jobs").update(toJobPatch(patch)).eq("id", id);
    if (error) fail("backup_job_update", error);
  }

  async failRunningJob(id: string, patch: BackupJobPatch): Promise<boolean> {
    const { data, error } = await this.client.from("backup_jobs").update(toJobPatch(patch)).eq("id", id).eq("status", "running").select("id");
    if (error) fail("backup_job_fail", error);
    return (data ?? []).length === 1;
  }

  async discardJob(id: string): Promise<void> {
    const { error } = await this.client.from("backup_jobs").delete().eq("id", id).eq("status", "running");
    if (error) fail("backup_job_discard", error);
  }

  async getJob(id: string): Promise<BackupJobRecord | null> {
    const { data, error } = await this.client.from("backup_jobs").select(JOB_COLUMNS).eq("id", id).maybeSingle();
    if (error) fail("backup_job_get", error);
    return data ? fromJob(data as unknown as JobRow) : null;
  }

  async listJobs(options: { includeDeleted?: boolean; limit?: number } = {}): Promise<BackupJobRecord[]> {
    let query = this.client.from("backup_jobs").select(JOB_COLUMNS);
    if (!options.includeDeleted) query = query.is("deleted_at", null);
    const { data, error } = await query.order("started_at", { ascending: false }).order("id", { ascending: false }).limit(options.limit ?? 200);
    if (error) fail("backup_job_list", error);
    return ((data ?? []) as unknown as JobRow[]).map(fromJob);
  }

  async audit(event: BackupAuditEvent): Promise<void> {
    const { error } = await this.client.from("backup_audit_events").insert({
      action: event.action,
      actor: event.actor,
      actor_user_id: event.actorUserId ?? null,
      job_id: event.jobId ?? null,
      details: event.details ?? {},
    });
    if (error) fail("backup_audit", error);
  }
}
