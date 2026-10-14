import { randomUUID } from "node:crypto";

import { RESTORE_TABLES, USER_SCOPED_TABLES } from "./manifest";
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
 * Bellek içi port uygulamaları: testler ve production Supabase'e dokunmayan
 * manuel deneme düzeneği için. Davranış (kilit koşulu, FK/sayı kontrolü,
 * üzerine yazmayan upload) Supabase/SQL tarafıyla aynı tutulur.
 */

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export class InMemoryBackupDatabase implements BackupDatabase {
  tables: Record<string, TableRow[]>;
  authUsers: Set<string>;
  staging = new Map<string, Map<string, Array<{ ord: number; row: TableRow }>>>();
  epoch: string | null = null;
  /** Hata enjeksiyonu (testler). */
  failExport: Error | null = null;
  failApply: Error | null = null;
  /** true: transaction işlenir ama yanıt "kaybolur" (ağ hatası benzetimi). */
  loseApplyResponse = false;
  onApply: ((jobId: string, epoch: string, counts: Record<string, number>) => Promise<void> | void) | null = null;
  exportCalls = 0;

  constructor(tables: Record<string, TableRow[]>, authUsers: Iterable<string>) {
    this.tables = clone(tables);
    this.authUsers = new Set(authUsers);
  }

  async exportSnapshot(): Promise<DbSnapshot> {
    this.exportCalls += 1;
    if (this.failExport) throw this.failExport;
    return { exportedAt: new Date().toISOString(), tables: clone(this.tables) };
  }

  async stageRows(jobId: string, table: string, rows: Array<{ ord: number; row: TableRow }>): Promise<void> {
    const job = this.staging.get(jobId) ?? new Map();
    job.set(table, [...(job.get(table) ?? []), ...clone(rows)]);
    this.staging.set(jobId, job);
  }

  async clearStaging(jobId: string): Promise<void> {
    this.staging.delete(jobId);
  }

  async applyRestore(jobId: string, expected: Record<string, number>): Promise<{ counts: Record<string, number>; epoch: string }> {
    if (this.failApply) throw this.failApply;
    const staged = this.staging.get(jobId) ?? new Map<string, Array<{ ord: number; row: TableRow }>>();
    for (const table of RESTORE_TABLES) {
      if (typeof expected[table] !== "number") throw new Error(`backup_restore_expected_missing:${table}`);
      if ((staged.get(table)?.length ?? 0) !== expected[table]) throw new Error(`backup_restore_staging_mismatch:${table}`);
    }
    for (const table of USER_SCOPED_TABLES) {
      for (const { row } of staged.get(table) ?? []) {
        if (typeof row.user_id === "string" && !this.authUsers.has(row.user_id)) throw new Error(`violates foreign key constraint (${table}.user_id)`);
      }
    }
    const counts: Record<string, number> = {};
    for (const table of RESTORE_TABLES) {
      const rows = [...(staged.get(table) ?? [])].sort((a, b) => a.ord - b.ord).map((item) => item.row);
      this.tables[table] = clone(rows);
      counts[table] = rows.length;
    }
    this.staging.delete(jobId);
    this.epoch = randomUUID();
    await this.onApply?.(jobId, this.epoch, counts);
    if (this.loseApplyResponse) throw new Error("fetch failed");
    return { counts, epoch: this.epoch };
  }

  async missingAuthUsers(ids: string[]): Promise<string[]> {
    return ids.filter((id) => !this.authUsers.has(id));
  }

  async workspaceOwner(): Promise<string | null> {
    const owner = this.tables.workspace_bootstrap?.[0]?.owner_id;
    return typeof owner === "string" ? owner : null;
  }
}

export class InMemoryBackupStorage implements BackupStorage {
  buckets = new Map<string, Map<string, { data: Buffer; contentType: string | null }>>();
  failDownload: ((bucket: string, path: string) => boolean) | null = null;
  failUpload: ((bucket: string, path: string) => boolean) | null = null;
  failRemove = false;

  constructor(bucketNames: readonly string[]) {
    for (const name of bucketNames) this.buckets.set(name, new Map());
  }

  put(bucket: string, path: string, data: Buffer | string, contentType: string | null = null) {
    this.bucket(bucket).set(path, { data: Buffer.from(data), contentType });
  }

  private bucket(name: string) {
    const bucket = this.buckets.get(name);
    if (!bucket) throw new Error(`Bucket yok: ${name}`);
    return bucket;
  }

  async list(bucket: string): Promise<StoredObject[]> {
    return [...this.bucket(bucket).entries()].map(([path, object]) => ({ path, bytes: object.data.length, contentType: object.contentType }));
  }

  async download(bucket: string, path: string) {
    if (this.failDownload?.(bucket, path)) throw new Error("download failed");
    const object = this.bucket(bucket).get(path);
    if (!object) throw new Error("Object not found");
    return { data: Buffer.from(object.data), contentType: object.contentType };
  }

  async upload(bucket: string, path: string, data: Buffer, contentType: string | null): Promise<void> {
    if (this.failUpload?.(bucket, path)) throw new Error("upload failed");
    if (this.bucket(bucket).has(path)) throw new Error("The resource already exists");
    this.bucket(bucket).set(path, { data: Buffer.from(data), contentType });
  }

  async remove(bucket: string, paths: string[]): Promise<void> {
    if (this.failRemove) throw new Error("remove failed");
    for (const path of paths) this.bucket(bucket).delete(path);
  }
}

export function defaultBackupSettings(): BackupSettingsRecord {
  return {
    autoEnabled: true,
    intervalMinutes: 1440,
    keepLast: 10,
    keepDailyDays: 7,
    keepWeeklyWeeks: 4,
    keepPreRestoreDays: 14,
    updatedAt: null,
    lockJobId: null,
    lockOperation: null,
    lockAcquiredAt: null,
    lockHeartbeatAt: null,
    cronLastSeenAt: null,
    lastUnchangedAt: null,
  };
}

export class InMemoryBackupMetaStore implements BackupMetaStore {
  settings: BackupSettingsRecord = defaultBackupSettings();
  jobs = new Map<string, BackupJobRecord>();
  auditLog: Array<BackupAuditEvent & { at: string }> = [];

  async getSettings() {
    return { ...this.settings };
  }

  async updateSettings(patch: BackupSettingsPatch, _userId: string, now: Date) {
    this.settings = { ...this.settings, ...patch, updatedAt: now.toISOString() };
    return { ...this.settings };
  }

  async acquireLock(lockId: string, operation: "backup" | "restore", now: Date, staleBefore: Date) {
    const held = this.settings.lockJobId;
    const beat = this.settings.lockHeartbeatAt ? Date.parse(this.settings.lockHeartbeatAt) : 0;
    if (held && beat >= staleBefore.getTime()) return false;
    this.settings = { ...this.settings, lockJobId: lockId, lockOperation: operation, lockAcquiredAt: now.toISOString(), lockHeartbeatAt: now.toISOString() };
    return true;
  }

  async heartbeat(lockId: string, now: Date) {
    if (this.settings.lockJobId !== lockId) return false;
    this.settings = { ...this.settings, lockHeartbeatAt: now.toISOString() };
    return true;
  }

  async releaseLock(lockId: string) {
    if (this.settings.lockJobId !== lockId) return;
    this.settings = { ...this.settings, lockJobId: null, lockOperation: null, lockAcquiredAt: null, lockHeartbeatAt: null };
  }

  async releaseStaleLock(lockId: string, staleBefore: Date) {
    const beat = this.settings.lockHeartbeatAt ? Date.parse(this.settings.lockHeartbeatAt) : 0;
    if (this.settings.lockJobId !== lockId || beat >= staleBefore.getTime()) return false;
    await this.releaseLock(lockId);
    return true;
  }

  async touchCron(now: Date) {
    this.settings = { ...this.settings, cronLastSeenAt: now.toISOString() };
  }

  async markUnchanged(now: Date) {
    this.settings = { ...this.settings, lastUnchangedAt: now.toISOString() };
  }

  async createJob(job: NewBackupJob) {
    this.jobs.set(job.id, {
      ...job,
      status: "running",
      fileName: null,
      sizeBytes: null,
      dbRowCount: null,
      mediaFileCount: null,
      summary: {},
      sourceBackupId: job.sourceBackupId ?? null,
      safetyBackupId: null,
      errorStage: null,
      errorMessage: null,
      heartbeatAt: job.startedAt,
      finishedAt: null,
      deletedAt: null,
      deletedBy: null,
      deletedReason: null,
    });
  }

  async updateJob(id: string, patch: BackupJobPatch) {
    const job = this.jobs.get(id);
    if (!job) throw new Error("job yok");
    this.jobs.set(id, { ...job, ...clone(patch) });
  }

  async failRunningJob(id: string, patch: BackupJobPatch) {
    const job = this.jobs.get(id);
    if (!job || job.status !== "running") return false;
    await this.updateJob(id, patch);
    return true;
  }

  async discardJob(id: string) {
    this.jobs.delete(id);
  }

  async getJob(id: string) {
    const job = this.jobs.get(id);
    return job ? clone(job) : null;
  }

  async listJobs(options: { includeDeleted?: boolean; limit?: number } = {}) {
    return [...this.jobs.values()]
      .filter((job) => options.includeDeleted || !job.deletedAt)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt) || b.id.localeCompare(a.id))
      .slice(0, options.limit ?? 200)
      .map(clone);
  }

  async audit(event: BackupAuditEvent) {
    this.auditLog.push({ ...clone(event), at: new Date().toISOString() });
  }
}
