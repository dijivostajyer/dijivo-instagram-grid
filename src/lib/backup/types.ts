import type {
  BackupActor,
  BackupJobKind,
  BackupOperation,
  BackupProgress,
  BackupSettingsPatch,
  BackupSettingsView,
  BackupStatus,
} from "./shared";

/** Sunucu tarafı portlar: Supabase ve bellek içi (test) uygulamaları vardır. */

export type TableRow = Record<string, unknown>;

export interface DbSnapshot {
  exportedAt: string;
  tables: Record<string, TableRow[]>;
}

export interface BackupDatabase {
  /** Tek ifadede tutarlı anlık görüntü (backup_export_snapshot RPC). */
  exportSnapshot(): Promise<DbSnapshot>;
  stageRows(jobId: string, table: string, rows: Array<{ ord: number; row: TableRow }>): Promise<void>;
  clearStaging(jobId: string): Promise<void>;
  /** Tek transaction'da değiştirme (backup_apply_restore RPC). */
  applyRestore(jobId: string, expected: Record<string, number>): Promise<{ counts: Record<string, number>; epoch: string }>;
  /** auth.users'ta bulunmayan kimlikler. */
  missingAuthUsers(ids: string[]): Promise<string[]>;
  workspaceOwner(): Promise<string | null>;
}

export interface StoredObject {
  path: string;
  bytes: number;
  contentType: string | null;
}

export interface BackupStorage {
  list(bucket: string): Promise<StoredObject[]>;
  download(bucket: string, path: string): Promise<{ data: Buffer; contentType: string | null }>;
  /** Asla üzerine yazmaz; nesne varsa hata verir. */
  upload(bucket: string, path: string, data: Buffer, contentType: string | null): Promise<void>;
  remove(bucket: string, paths: string[]): Promise<void>;
}

export interface BackupJobSummary {
  progress?: BackupProgress | null;
  fingerprint?: string;
  tables?: Record<string, number>;
  buckets?: Array<{ name: string; files: number; bytes: number }>;
  warnings?: string[];
  durationMs?: number;
  dbCommittedAt?: string;
  epoch?: string;
  restoredCounts?: Record<string, number>;
  mediaUploaded?: number;
  mediaRemoved?: number;
}

export interface BackupJobRecord {
  id: string;
  operation: BackupOperation;
  kind: BackupJobKind;
  status: BackupStatus;
  actor: BackupActor;
  actorUserId: string | null;
  fileName: string | null;
  sizeBytes: number | null;
  dbRowCount: number | null;
  mediaFileCount: number | null;
  summary: BackupJobSummary;
  sourceBackupId: string | null;
  safetyBackupId: string | null;
  errorStage: string | null;
  errorMessage: string | null;
  startedAt: string;
  heartbeatAt: string | null;
  finishedAt: string | null;
  deletedAt: string | null;
  deletedBy: string | null;
  deletedReason: "user" | "retention" | null;
}

export type NewBackupJob = Pick<BackupJobRecord, "id" | "operation" | "kind" | "actor" | "actorUserId" | "startedAt"> & {
  sourceBackupId?: string | null;
};

export type BackupJobPatch = Partial<Omit<BackupJobRecord, "id" | "operation" | "kind" | "actor" | "startedAt">>;

export interface BackupSettingsRecord extends BackupSettingsView {
  lockJobId: string | null;
  lockOperation: BackupOperation | null;
  lockAcquiredAt: string | null;
  lockHeartbeatAt: string | null;
  cronLastSeenAt: string | null;
  lastUnchangedAt: string | null;
}

export type BackupAuditAction =
  | "backup_started"
  | "backup_succeeded"
  | "backup_failed"
  | "restore_started"
  | "restore_succeeded"
  | "restore_failed"
  | "backup_deleted"
  | "retention_deleted"
  | "settings_updated"
  | "backup_downloaded"
  | "stale_lock_released";

export interface BackupAuditEvent {
  action: BackupAuditAction;
  actor: "user" | "cron" | "system";
  actorUserId?: string | null;
  jobId?: string | null;
  details?: Record<string, unknown>;
}

export interface BackupMetaStore {
  getSettings(): Promise<BackupSettingsRecord>;
  updateSettings(patch: BackupSettingsPatch, userId: string, now: Date): Promise<BackupSettingsRecord>;
  /** Kilit boşsa veya kalp atışı `staleBefore`'dan eskiyse alır (tek koşullu UPDATE). */
  acquireLock(lockId: string, operation: BackupOperation, now: Date, staleBefore: Date): Promise<boolean>;
  /** Kilidi tazeler; kilit artık bu kimlikte değilse false. */
  heartbeat(lockId: string, now: Date): Promise<boolean>;
  releaseLock(lockId: string): Promise<void>;
  /** Kilit hâlâ bu kimlikte ve bayatsa bırakır. */
  releaseStaleLock(lockId: string, staleBefore: Date): Promise<boolean>;
  touchCron(now: Date): Promise<void>;
  markUnchanged(now: Date): Promise<void>;
  createJob(job: NewBackupJob): Promise<void>;
  updateJob(id: string, patch: BackupJobPatch): Promise<void>;
  /** Yalnız status=running iken başarısız işaretler (canlı işi ezmemek için). */
  failRunningJob(id: string, patch: BackupJobPatch): Promise<boolean>;
  /** Hiç dosya üretmeden biten (değişiklik yok) iş kaydını kaldırır. */
  discardJob(id: string): Promise<void>;
  getJob(id: string): Promise<BackupJobRecord | null>;
  /** En yeni başta. */
  listJobs(options?: { includeDeleted?: boolean; limit?: number }): Promise<BackupJobRecord[]>;
  audit(event: BackupAuditEvent): Promise<void>;
}
