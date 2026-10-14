import { createHash, randomUUID } from "node:crypto";
import type { ReadStream } from "node:fs";

import { backupFileName, type BackupFileStore } from "./files";
import {
  AUDIT_ONLY_TABLES,
  BACKUP_EXCLUDED,
  BACKUP_FORMAT,
  BACKUP_FORMAT_VERSION,
  BACKUP_SCHEMA_VERSION,
  BACKUP_TABLES,
  MANIFEST_ENTRY,
  RESTORE_TABLES,
  USER_SCOPED_TABLES,
  fileEntry,
  isSafeArchivePath,
  parseManifest,
  tableEntry,
  type BackupManifest,
  type ManifestFile,
  type ManifestTable,
} from "./manifest";
import {
  isBackupDue,
  manualCooldownUntil,
  nextAutoBackupAt,
  parseBackupSettingsPatch,
  selectRetentionDeletes,
  stageLabel,
  UUID_RE,
  type BackupDetails,
  type BackupJobView,
  type BackupKind,
  type BackupOverview,
  type BackupProgress,
  type BackupSettingsView,
  type BackupValidationResult,
} from "./shared";
import type {
  BackupAuditEvent,
  BackupDatabase,
  BackupJobRecord,
  BackupJobSummary,
  BackupMetaStore,
  BackupSettingsRecord,
  BackupStorage,
  StoredObject,
  TableRow,
} from "./types";
import { ZipReader, ZipWriter } from "./zip";

export type BackupErrorCode =
  | "busy"
  | "cooldown"
  | "not_found"
  | "not_restorable"
  | "in_use"
  | "invalid_request"
  | "storage_unavailable"
  | "failed";

/** Kullanıcıya gösterilebilir (Türkçe, güvenli) hata. */
export class BackupError extends Error {
  constructor(
    readonly code: BackupErrorCode,
    message: string,
    readonly status: number,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

/** Aşama + kullanıcı mesajı; ham hata yalnız sunucu loguna gider. */
class StageError extends Error {
  constructor(readonly stage: string, readonly userMessage: string, readonly causeError?: unknown) {
    super(userMessage);
  }
}

const STAGE_MESSAGES: Record<string, string> = {
  prepare: "Yedek hazırlanamadı.",
  export_db: "Veritabanı dışa aktarılamadı.",
  list_media: "Medya listesi alınamadı.",
  download_media: "Medya dosyası indirilemedi.",
  write_package: "Yedek dosyası yazılamadı (disk alanını kontrol edin).",
  verify_package: "Yazılan yedek paketi doğrulanamadı.",
  finalize: "Yedek dosyası tamamlanamadı.",
};

export type BackupLogger = (event: string, details: Record<string, unknown>) => void;

const defaultLogger: BackupLogger = (event, details) => {
  const line = { event, ...details };
  if (event.endsWith("failed") || event.endsWith("error")) console.error("[backup]", line);
  else console.info("[backup]", line);
};

function errorText(error: unknown): string {
  if (error instanceof StageError && error.causeError) return `${error.userMessage} (${errorText(error.causeError)})`;
  if (error instanceof Error) return error.message;
  return "bilinmeyen hata";
}

const sha256 = (data: Uint8Array | string) => createHash("sha256").update(data).digest("hex");

export interface BackupEngineOptions {
  db: BackupDatabase;
  storage: BackupStorage;
  meta: BackupMetaStore;
  /** BACKUP_DIR geçersizse null; yedek alma/geri yükleme devre dışı kalır. */
  files: BackupFileStore | null;
  storageError?: string | null;
  buckets: readonly string[];
  appVersion: string;
  cronConfigured?: boolean;
  now?: () => Date;
  randomId?: () => string;
  /** Bu süre kalp atışı gelmeyen kilit/iş bayat sayılır. */
  staleMs?: number;
  heartbeatMs?: number;
  stagingBatchRows?: number;
  stagingBatchBytes?: number;
  logger?: BackupLogger;
}

interface JobContext {
  id: string;
  lockId: string;
  ownsLock: boolean;
  kind: BackupKind | "restore";
  actor: "user" | "cron";
  actorUserId: string | null;
  startedAt: Date;
  summary: BackupJobSummary;
  stage: string;
  lastBeat: number;
}

export type BackupRunResult =
  | { status: "succeeded"; jobId: string; manifest: BackupManifest }
  | { status: "unchanged"; jobId: string };

export type ScheduledRunResult =
  | { status: "disabled" }
  | { status: "not_due"; nextAt: string | null }
  | { status: "busy" }
  | { status: "unchanged" }
  | { status: "succeeded"; jobId: string }
  | { status: "failed"; jobId?: string; error: string };

export interface RestoreResult {
  jobId: string;
  epoch: string;
  safetyBackupId: string;
  warnings: string[];
}

type PackageReport =
  | { ok: true; manifest: BackupManifest; tables: Record<string, TableRow[]>; warnings: string[] }
  | { ok: false; error: string };

export function toJobView(job: BackupJobRecord): BackupJobView {
  const started = Date.parse(job.startedAt);
  const finished = job.finishedAt ? Date.parse(job.finishedAt) : NaN;
  return {
    id: job.id,
    operation: job.operation,
    kind: job.kind,
    status: job.status,
    actor: job.actor,
    actorUserId: job.actorUserId,
    fileName: job.fileName,
    sizeBytes: job.sizeBytes,
    dbRowCount: job.dbRowCount,
    mediaFileCount: job.mediaFileCount,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    durationMs: Number.isFinite(finished) ? Math.max(0, finished - started) : null,
    errorStage: job.errorStage,
    errorMessage: job.errorMessage,
    sourceBackupId: job.sourceBackupId,
    safetyBackupId: job.safetyBackupId,
    progress: job.status === "running" ? job.summary.progress ?? null : null,
    warnings: job.summary.warnings ?? [],
    restorable: job.operation === "backup" && job.status === "succeeded" && !job.deletedAt && Boolean(job.fileName),
    restoreEpoch: job.operation === "restore" && job.summary.dbCommittedAt ? job.summary.epoch ?? null : null,
  };
}

function settingsView(settings: BackupSettingsRecord): BackupSettingsView {
  return {
    autoEnabled: settings.autoEnabled,
    intervalMinutes: settings.intervalMinutes,
    keepLast: settings.keepLast,
    keepDailyDays: settings.keepDailyDays,
    keepWeeklyWeeks: settings.keepWeeklyWeeks,
    keepPreRestoreDays: settings.keepPreRestoreDays,
    updatedAt: settings.updatedAt,
  };
}

/**
 * Yedekleme + geri yükleme iş akışı. Tüm dış bağımlılıklar port üzerinden
 * gelir (Supabase / bellek içi); kilit ve iş durumu veritabanında tutulur,
 * process yeniden başlasa bile bayat kilit/iş temizlenir.
 */
export class BackupEngine {
  private readonly now: () => Date;
  private readonly randomId: () => string;
  private readonly staleMs: number;
  private readonly heartbeatMs: number;
  private readonly batchRows: number;
  private readonly batchBytes: number;
  private readonly log: BackupLogger;

  constructor(private readonly options: BackupEngineOptions) {
    this.now = options.now ?? (() => new Date());
    this.randomId = options.randomId ?? randomUUID;
    this.staleMs = options.staleMs ?? 10 * 60_000;
    this.heartbeatMs = options.heartbeatMs ?? 5_000;
    this.batchRows = options.stagingBatchRows ?? 500;
    this.batchBytes = options.stagingBatchBytes ?? 4 * 1024 * 1024;
    this.log = options.logger ?? defaultLogger;
  }

  private get db() {
    return this.options.db;
  }
  private get storage() {
    return this.options.storage;
  }
  private get meta() {
    return this.options.meta;
  }

  private requireFiles(): BackupFileStore {
    if (!this.options.files) {
      throw new BackupError("storage_unavailable", this.options.storageError ?? "Yedek dizini yapılandırılmamış.", 503);
    }
    return this.options.files;
  }

  private staleBefore(now: Date): Date {
    return new Date(now.getTime() - this.staleMs);
  }

  private async audit(event: BackupAuditEvent): Promise<void> {
    try {
      await this.meta.audit(event);
    } catch (error) {
      this.log("audit_error", { action: event.action, error: errorText(error) });
    }
  }

  // ---------------------------------------------------------------
  // Kilit, iş ve bayat kayıt temizliği
  // ---------------------------------------------------------------

  /** Kalp atışı kesilmiş kilidi bırakır ve yarıda kalmış işleri "başarısız" yapar. */
  async recoverStale(): Promise<void> {
    const now = this.now();
    const staleBefore = this.staleBefore(now);
    const settings = await this.meta.getSettings();
    let liveLock: string | null = null;
    if (settings.lockJobId) {
      const beat = settings.lockHeartbeatAt ? Date.parse(settings.lockHeartbeatAt) : 0;
      if (beat < staleBefore.getTime()) {
        if (await this.meta.releaseStaleLock(settings.lockJobId, staleBefore)) {
          this.log("stale_lock_released", { lockJobId: settings.lockJobId });
          await this.audit({ action: "stale_lock_released", actor: "system", details: { lockJobId: settings.lockJobId } });
        }
      } else {
        liveLock = settings.lockJobId;
      }
    }
    const jobs = await this.meta.listJobs({ includeDeleted: false, limit: 200 });
    for (const job of jobs) {
      if (job.status !== "running" || job.id === liveLock) continue;
      if (Date.parse(job.heartbeatAt ?? job.startedAt) >= staleBefore.getTime()) continue;
      const committed = job.operation === "restore" && Boolean(job.summary.dbCommittedAt);
      const message = job.operation === "backup"
        ? "Yedekleme yarıda kesildi (sunucu yeniden başlatılmış olabilir); yedek dosyası oluşturulmadı."
        : committed
          ? "Veritabanı geri yüklendi ancak işlem tamamlanamadı (sunucu yeniden başlatılmış olabilir); eski medya temizliği eksik kalmış olabilir."
          : "Geri yükleme yarıda kesildi (sunucu yeniden başlatılmış olabilir); veritabanı değiştirilmedi.";
      const failed = await this.meta.failRunningJob(job.id, {
        status: "failed",
        errorStage: job.summary.progress?.stage ?? "interrupted",
        errorMessage: message,
        finishedAt: now.toISOString(),
        summary: { ...job.summary, progress: null },
      });
      if (!failed) continue;
      if (job.operation === "backup" && this.options.files) await this.options.files.removePartial(backupFileName(new Date(job.startedAt), job.id));
      if (job.operation === "restore" && !committed) await this.db.clearStaging(job.id).catch(() => undefined);
      await this.audit({ action: job.operation === "backup" ? "backup_failed" : "restore_failed", actor: "system", jobId: job.id, details: { interrupted: true } });
    }
    if (!liveLock && this.options.files) await this.options.files.cleanupPartials(staleBefore).catch(() => 0);
  }

  private async beginJob(input: {
    operation: "backup" | "restore";
    kind: BackupKind | "restore";
    actor: "user" | "cron";
    actorUserId: string | null;
    lockId?: string;
    sourceBackupId?: string | null;
  }): Promise<JobContext> {
    const now = this.now();
    const id = this.randomId();
    const ownsLock = !input.lockId;
    if (ownsLock) {
      await this.recoverStale();
      const acquired = await this.meta.acquireLock(id, input.operation, now, this.staleBefore(now));
      if (!acquired) throw new BackupError("busy", "Başka bir yedekleme veya geri yükleme işlemi sürüyor. Lütfen bitmesini bekleyin.", 409);
    }
    try {
      await this.meta.createJob({
        id,
        operation: input.operation,
        kind: input.kind,
        actor: input.actor,
        actorUserId: input.actorUserId,
        startedAt: now.toISOString(),
        sourceBackupId: input.sourceBackupId ?? null,
      });
    } catch (error) {
      if (ownsLock) await this.meta.releaseLock(id).catch(() => undefined);
      throw error;
    }
    return {
      id,
      lockId: input.lockId ?? id,
      ownsLock,
      kind: input.kind,
      actor: input.actor,
      actorUserId: input.actorUserId,
      startedAt: now,
      summary: { progress: { stage: "prepare" } },
      stage: "prepare",
      lastBeat: 0,
    };
  }

  /** Kilidi tazeler ve ilerlemeyi yazar (en sık `heartbeatMs`'de bir). */
  private async beat(ctx: JobContext, progress: BackupProgress, force = false): Promise<void> {
    ctx.stage = progress.stage;
    ctx.summary.progress = progress;
    const now = this.now();
    if (!force && now.getTime() - ctx.lastBeat < this.heartbeatMs) return;
    ctx.lastBeat = now.getTime();
    if (!(await this.meta.heartbeat(ctx.lockId, now))) {
      throw new StageError(ctx.stage, "İşlem kilidi kaybedildi; işlem güvenlik için durduruldu.");
    }
    await this.meta.updateJob(ctx.id, { heartbeatAt: now.toISOString(), summary: ctx.summary });
  }

  // ---------------------------------------------------------------
  // Yedekleme
  // ---------------------------------------------------------------

  private async lastRegularBackup(includeDeleted: boolean): Promise<BackupJobRecord | null> {
    const jobs = await this.meta.listJobs({ includeDeleted, limit: 100 });
    return jobs.find((job) => job.operation === "backup" && (job.kind === "manual" || job.kind === "scheduled") && job.status === "succeeded") ?? null;
  }

  /** "Şimdi Yedekle": kontrolleri yapar, işi başlatır, tamamlanmayı ayrı döndürür. */
  async startManualBackup(userId: string): Promise<{ job: BackupJobView; completion: Promise<BackupRunResult> }> {
    this.requireFiles();
    const now = this.now();
    const jobs = await this.meta.listJobs({ includeDeleted: true, limit: 100 });
    const lastManual = jobs.find((job) => job.operation === "backup" && job.kind === "manual" && job.status === "succeeded");
    const until = manualCooldownUntil(lastManual ? new Date(lastManual.finishedAt ?? lastManual.startedAt) : null, now);
    if (until) {
      const minutes = Math.max(1, Math.ceil((until.getTime() - now.getTime()) / 60_000));
      throw new BackupError("cooldown", `Yeni bir manuel yedek için ${minutes} dakika bekleyin.`, 429, { retryAt: until.toISOString() });
    }
    const ctx = await this.beginJob({ operation: "backup", kind: "manual", actor: "user", actorUserId: userId });
    const completion = this.executeBackup(ctx, { skipIfUnchanged: false });
    const job = await this.meta.getJob(ctx.id);
    return { job: toJobView(job ?? this.placeholder(ctx)), completion };
  }

  private placeholder(ctx: JobContext): BackupJobRecord {
    return {
      id: ctx.id, operation: ctx.kind === "restore" ? "restore" : "backup", kind: ctx.kind, status: "running", actor: ctx.actor,
      actorUserId: ctx.actorUserId, fileName: null, sizeBytes: null, dbRowCount: null, mediaFileCount: null, summary: ctx.summary,
      sourceBackupId: null, safetyBackupId: null, errorStage: null, errorMessage: null, startedAt: ctx.startedAt.toISOString(),
      heartbeatAt: null, finishedAt: null, deletedAt: null, deletedBy: null, deletedReason: null,
    };
  }

  private async executeBackup(ctx: JobContext, options: { skipIfUnchanged: boolean }): Promise<BackupRunResult> {
    const files = this.requireFiles();
    const name = backupFileName(ctx.startedAt, ctx.id);
    let writer: ZipWriter | null = null;
    let finalized = false;
    try {
      await this.beat(ctx, { stage: "export_db" }, true);
      const snapshot = await this.db.exportSnapshot().catch((error) => {
        throw new StageError("export_db", STAGE_MESSAGES.export_db, error);
      });
      for (const table of BACKUP_TABLES) {
        if (!Array.isArray(snapshot.tables?.[table])) throw new StageError("export_db", `Veritabanı dışa aktarımı eksik: ${table}`);
      }

      await this.beat(ctx, { stage: "list_media" }, true);
      const listings: Array<{ bucket: string; objects: StoredObject[] }> = [];
      for (const bucket of this.options.buckets) {
        const objects = await this.storage.list(bucket).catch((error) => {
          throw new StageError("list_media", STAGE_MESSAGES.list_media, error);
        });
        listings.push({ bucket, objects: [...objects].sort((a, b) => a.path.localeCompare(b.path)) });
      }

      const tableData = BACKUP_TABLES.map((table) => {
        const data = Buffer.from(JSON.stringify(snapshot.tables[table]), "utf8");
        return { table, data, rows: snapshot.tables[table].length, sha: sha256(data) };
      });
      const fingerprint = sha256([
        ...tableData.map((item) => `${item.table}:${item.sha}`),
        ...listings.flatMap(({ bucket, objects }) => objects.map((object) => `${bucket}/${object.path}:${object.bytes}`)),
      ].join("\n"));

      if (options.skipIfUnchanged) {
        const previous = await this.lastRegularBackup(false);
        if (previous?.summary.fingerprint === fingerprint && previous.fileName && (await files.exists(previous.fileName))) {
          await this.meta.discardJob(ctx.id);
          await this.meta.markUnchanged(this.now());
          this.log("backup_unchanged", { previousId: previous.id });
          return { status: "unchanged", jobId: previous.id };
        }
      }

      await this.audit({ action: "backup_started", actor: ctx.actor, actorUserId: ctx.actorUserId, jobId: ctx.id, details: { kind: ctx.kind } });
      await this.beat(ctx, { stage: "write_package" }, true);
      try {
        await files.ensureDir();
        writer = await ZipWriter.create(files.partialPath(name));
      } catch (error) {
        throw new StageError("write_package", STAGE_MESSAGES.write_package, error);
      }
      const date = ctx.startedAt;
      const tables: ManifestTable[] = [];
      for (const item of tableData) {
        const entry = tableEntry(item.table);
        await writer.add(entry, item.data, { compress: true, date });
        tables.push({ name: item.table, entry, rows: item.rows, bytes: item.data.length, sha256: item.sha, restore: (RESTORE_TABLES as readonly string[]).includes(item.table) });
      }

      const total = listings.reduce((sum, listing) => sum + listing.objects.length, 0);
      const manifestFiles: ManifestFile[] = [];
      const warnings: string[] = [];
      let done = 0;
      await this.beat(ctx, { stage: "download_media", done, total }, true);
      for (const { bucket, objects } of listings) {
        for (const object of objects) {
          done += 1;
          if (!isSafeArchivePath(object.path)) {
            warnings.push(`Güvensiz adlı medya dosyası pakete alınmadı: ${bucket}/${object.path}`);
            continue;
          }
          const { data, contentType } = await this.storage.download(bucket, object.path).catch((error) => {
            throw new StageError("download_media", `${STAGE_MESSAGES.download_media} (${bucket}/${object.path})`, error);
          });
          const entry = fileEntry(bucket, object.path);
          await writer.add(entry, data, { date });
          manifestFiles.push({ bucket, path: object.path, entry, bytes: data.length, sha256: sha256(data), contentType: contentType ?? object.contentType ?? null });
          await this.beat(ctx, { stage: "download_media", done, total });
        }
      }

      const buckets = this.options.buckets.map((bucket) => {
        const list = manifestFiles.filter((file) => file.bucket === bucket);
        return { name: bucket, files: list.length, bytes: list.reduce((sum, file) => sum + file.bytes, 0) };
      });
      const rows = tables.reduce((sum, table) => sum + table.rows, 0);
      const manifest: BackupManifest = {
        format: BACKUP_FORMAT,
        formatVersion: BACKUP_FORMAT_VERSION,
        backupId: ctx.id,
        kind: ctx.kind as BackupKind,
        createdAt: ctx.startedAt.toISOString(),
        completedAt: this.now().toISOString(),
        appVersion: this.options.appVersion,
        schemaVersion: BACKUP_SCHEMA_VERSION,
        complete: true,
        fingerprint,
        tables,
        buckets,
        files: manifestFiles,
        totals: { rows, files: manifestFiles.length, mediaBytes: buckets.reduce((sum, bucket) => sum + bucket.bytes, 0) },
        warnings,
        excluded: [...BACKUP_EXCLUDED],
      };
      await this.beat(ctx, { stage: "write_package" }, true);
      await writer.add(MANIFEST_ENTRY, Buffer.from(JSON.stringify(manifest, null, 2), "utf8"), { compress: true, date });
      await writer.close();
      writer = null;

      await this.beat(ctx, { stage: "verify_package" }, true);
      await this.verifyWrittenPackage(files.partialPath(name), manifest);

      ctx.stage = "finalize";
      const size = await files.finalize(name).catch((error) => {
        throw new StageError("finalize", STAGE_MESSAGES.finalize, error);
      });
      finalized = true;
      const finishedAt = this.now();
      ctx.summary = {
        progress: null,
        fingerprint,
        tables: Object.fromEntries(tables.map((table) => [table.name, table.rows])),
        buckets,
        warnings,
        durationMs: finishedAt.getTime() - ctx.startedAt.getTime(),
      };
      // "Başarılı" yalnız dosya tamamlanıp doğrulandıktan SONRA yazılır.
      await this.meta.updateJob(ctx.id, {
        status: "succeeded",
        fileName: name,
        sizeBytes: size,
        dbRowCount: rows,
        mediaFileCount: manifestFiles.length,
        finishedAt: finishedAt.toISOString(),
        heartbeatAt: finishedAt.toISOString(),
        summary: ctx.summary,
      });
      this.log("backup_succeeded", { jobId: ctx.id, kind: ctx.kind, size, rows, files: manifestFiles.length });
      await this.audit({ action: "backup_succeeded", actor: ctx.actor, actorUserId: ctx.actorUserId, jobId: ctx.id, details: { kind: ctx.kind, size, rows, files: manifestFiles.length } });

      if (ctx.kind === "manual" || ctx.kind === "scheduled") {
        if (ctx.ownsLock) {
          // Saklama temizliği kilidi tutarken yapılır; başarısızlığı yedeği bozmaz.
          await this.applyRetention(ctx.id).catch((error) => this.log("retention_failed", { error: errorText(error) }));
        }
      }
      return { status: "succeeded", jobId: ctx.id, manifest };
    } catch (error) {
      if (writer) await writer.abort();
      else await files.removePartial(name).catch(() => undefined);
      if (finalized) await files.remove(name).catch(() => undefined);
      const stage = error instanceof StageError ? error.stage : ctx.stage;
      const message = `Yedekleme başarısız: ${error instanceof StageError ? error.userMessage : STAGE_MESSAGES[stage] ?? "beklenmeyen hata."}`;
      this.log("backup_failed", { jobId: ctx.id, kind: ctx.kind, stage, error: errorText(error) });
      await this.meta.updateJob(ctx.id, {
        status: "failed",
        errorStage: stage,
        errorMessage: message,
        finishedAt: this.now().toISOString(),
        summary: { ...ctx.summary, progress: null },
      }).catch((updateError) => this.log("job_update_error", { jobId: ctx.id, error: errorText(updateError) }));
      await this.audit({ action: "backup_failed", actor: ctx.actor, actorUserId: ctx.actorUserId, jobId: ctx.id, details: { kind: ctx.kind, stage } });
      throw new BackupError("failed", message, 500, { jobId: ctx.id, stage });
    } finally {
      if (ctx.ownsLock) {
        await this.meta.releaseLock(ctx.lockId).catch((error) => this.log("lock_release_error", { error: errorText(error) }));
      }
    }
  }

  private async verifyWrittenPackage(path: string, manifest: BackupManifest): Promise<void> {
    let reader: ZipReader | null = null;
    try {
      reader = await ZipReader.open(path);
      const expected = 1 + manifest.tables.length + manifest.files.length;
      if (reader.entries().length !== expected) throw new Error("girdi sayısı tutmuyor");
      const parsed = parseManifest(JSON.parse((await reader.read(MANIFEST_ENTRY)).toString("utf8")), this.options.buckets);
      if (!parsed.ok) throw new Error(parsed.error);
    } catch (error) {
      throw new StageError("verify_package", STAGE_MESSAGES.verify_package, error);
    } finally {
      await reader?.close();
    }
  }

  // ---------------------------------------------------------------
  // Saklama politikası
  // ---------------------------------------------------------------

  private async applyRetention(justCreatedId: string): Promise<void> {
    const files = this.requireFiles();
    const now = this.now();
    const settings = await this.meta.getSettings();
    const jobs = await this.meta.listJobs({ includeDeleted: false, limit: 1000 });
    const protectedIds = new Set<string>([justCreatedId]);
    for (const job of jobs) {
      if (job.operation === "restore" && job.status === "running") {
        if (job.sourceBackupId) protectedIds.add(job.sourceBackupId);
        if (job.safetyBackupId) protectedIds.add(job.safetyBackupId);
      }
    }
    const candidates = jobs
      .filter((job) => job.operation === "backup" && job.status === "succeeded" && job.fileName)
      .map((job) => ({ id: job.id, kind: job.kind as BackupKind, takenAt: job.startedAt }));
    const deletions = selectRetentionDeletes(candidates, settings, now, protectedIds);
    for (const id of deletions) {
      const job = jobs.find((item) => item.id === id);
      if (!job?.fileName) continue;
      await files.remove(job.fileName);
      await this.meta.updateJob(id, { deletedAt: now.toISOString(), deletedBy: null, deletedReason: "retention" });
      await this.audit({ action: "retention_deleted", actor: "system", jobId: id, details: { kind: job.kind, fileName: job.fileName } });
    }
    if (deletions.length) this.log("retention_applied", { deleted: deletions.length });
  }

  // ---------------------------------------------------------------
  // Zamanlanmış yedek (cron)
  // ---------------------------------------------------------------

  async runScheduled(): Promise<ScheduledRunResult> {
    const now = this.now();
    await this.meta.touchCron(now);
    const settings = await this.meta.getSettings();
    if (!settings.autoEnabled) return { status: "disabled" };
    const last = await this.lastRegularBackup(true);
    const lastRunAt = latestDate(last?.startedAt ?? null, settings.lastUnchangedAt);
    if (!isBackupDue(settings, lastRunAt, now)) {
      return { status: "not_due", nextAt: nextAutoBackupAt(settings, lastRunAt, now)?.toISOString() ?? null };
    }
    if (!this.options.files) return { status: "failed", error: this.options.storageError ?? "Yedek dizini yapılandırılmamış." };
    let ctx: JobContext;
    try {
      ctx = await this.beginJob({ operation: "backup", kind: "scheduled", actor: "cron", actorUserId: null });
    } catch (error) {
      if (error instanceof BackupError && error.code === "busy") return { status: "busy" };
      throw error;
    }
    try {
      const result = await this.executeBackup(ctx, { skipIfUnchanged: true });
      return result.status === "unchanged" ? { status: "unchanged" } : { status: "succeeded", jobId: result.jobId };
    } catch (error) {
      return { status: "failed", jobId: ctx.id, error: error instanceof Error ? error.message : "Yedekleme başarısız." };
    }
  }

  // ---------------------------------------------------------------
  // Doğrulama
  // ---------------------------------------------------------------

  private async requireBackupJob(id: string): Promise<BackupJobRecord> {
    if (!UUID_RE.test(id)) throw new BackupError("not_found", "Yedek bulunamadı.", 404);
    const job = await this.meta.getJob(id.toLowerCase());
    if (!job || job.deletedAt) throw new BackupError("not_found", "Yedek bulunamadı.", 404);
    return job;
  }

  async validateBackup(id: string): Promise<BackupValidationResult> {
    const job = await this.requireBackupJob(id);
    if (job.operation !== "backup" || job.status !== "succeeded" || !job.fileName) {
      return { ok: false, errors: ["Yalnız başarıyla tamamlanmış yedekler doğrulanabilir."], warnings: [] };
    }
    const report = await this.inspectPackage(job, false);
    return report.ok ? { ok: true, errors: [], warnings: report.warnings } : { ok: false, errors: [report.error], warnings: [] };
  }

  /**
   * Paketin tamamını doğrular: ZIP okunabilirliği, manifest varlığı/sürümü,
   * şema sürümü, yedek kimliği, beklenen tablolar, tanımsız girdi olmaması,
   * her girdinin CRC32 + SHA-256 + boyutu ve JSON satır sayıları.
   */
  private async inspectPackage(job: BackupJobRecord, keepTables: boolean): Promise<PackageReport> {
    const files = this.requireFiles();
    if (!job.fileName || !(await files.exists(job.fileName))) return { ok: false, error: "Yedek dosyası bulunamadı." };
    let reader: ZipReader;
    try {
      reader = await ZipReader.open(files.filePath(job.fileName));
    } catch {
      return { ok: false, error: "ZIP dosyası okunamadı veya bozuk." };
    }
    try {
      if (!reader.has(MANIFEST_ENTRY)) return { ok: false, error: "Yedekte manifest.json bulunamadı." };
      let raw: unknown;
      try {
        raw = JSON.parse((await reader.read(MANIFEST_ENTRY)).toString("utf8"));
      } catch {
        return { ok: false, error: "manifest.json okunamadı." };
      }
      const parsed = parseManifest(raw, this.options.buckets);
      if (!parsed.ok) return { ok: false, error: parsed.error };
      const manifest = parsed.manifest;
      if (manifest.backupId !== job.id) return { ok: false, error: "Manifest bu yedek kaydına ait değil." };
      if (Number(manifest.schemaVersion.padEnd(14, "0")) > Number(BACKUP_SCHEMA_VERSION)) {
        return { ok: false, error: "Bu yedek daha yeni bir veritabanı şemasıyla alınmış; bu sürümde geri yüklenemez." };
      }
      const known = new Set([MANIFEST_ENTRY, ...manifest.tables.map((table) => table.entry), ...manifest.files.map((file) => file.entry)]);
      const unknown = reader.entries().find((entry) => !known.has(entry.name));
      if (unknown) return { ok: false, error: `Pakette manifest'te olmayan dosya var: ${unknown.name}` };

      const tables: Record<string, TableRow[]> = {};
      for (const table of manifest.tables) {
        if (!reader.has(table.entry)) return { ok: false, error: `Tablo dosyası eksik: ${table.entry}` };
        let data: Buffer;
        try {
          data = await reader.read(table.entry);
        } catch {
          return { ok: false, error: `Tablo dosyası bozuk: ${table.entry}` };
        }
        if (data.length !== table.bytes || sha256(data) !== table.sha256) return { ok: false, error: `Sağlama toplamı tutmuyor: ${table.entry}` };
        let rows: unknown;
        try {
          rows = JSON.parse(data.toString("utf8"));
        } catch {
          return { ok: false, error: `Tablo JSON'u okunamadı: ${table.entry}` };
        }
        if (!Array.isArray(rows) || rows.length !== table.rows || rows.some((row) => typeof row !== "object" || row === null || Array.isArray(row))) {
          return { ok: false, error: `Tablo içeriği manifest ile uyuşmuyor: ${table.entry}` };
        }
        if (keepTables && (table.restore || (AUDIT_ONLY_TABLES as readonly string[]).includes(table.name))) tables[table.name] = rows as TableRow[];
      }
      for (const file of manifest.files) {
        if (!reader.has(file.entry)) return { ok: false, error: `Medya dosyası eksik: ${file.entry}` };
        let data: Buffer;
        try {
          data = await reader.read(file.entry);
        } catch {
          return { ok: false, error: `Medya dosyası bozuk: ${file.entry}` };
        }
        if (data.length !== file.bytes || sha256(data) !== file.sha256) return { ok: false, error: `Sağlama toplamı tutmuyor: ${file.entry}` };
      }
      if (manifest.totals.files !== manifest.files.length) return { ok: false, error: "Manifest medya sayısı tutarsız." };
      return { ok: true, manifest, tables, warnings: manifest.warnings };
    } finally {
      await reader.close();
    }
  }

  // ---------------------------------------------------------------
  // Geri yükleme
  // ---------------------------------------------------------------

  async startRestore(id: string, userId: string): Promise<{ job: BackupJobView; completion: Promise<RestoreResult> }> {
    this.requireFiles();
    const source = await this.requireBackupJob(id);
    if (source.operation !== "backup" || source.status !== "succeeded" || !source.fileName) {
      throw new BackupError("not_restorable", "Yalnız başarıyla tamamlanmış yedekler geri yüklenebilir.", 409);
    }
    const ctx = await this.beginJob({ operation: "restore", kind: "restore", actor: "user", actorUserId: userId, sourceBackupId: source.id });
    await this.audit({ action: "restore_started", actor: "user", actorUserId: userId, jobId: ctx.id, details: { sourceBackupId: source.id } });
    const completion = this.executeRestore(ctx, source);
    const job = await this.meta.getJob(ctx.id);
    return { job: toJobView(job ?? this.placeholder(ctx)), completion };
  }

  /**
   * 1. doğrula → 2. geri yükleme öncesi güvenlik yedeği → 3. medya hazırlama
   * (yalnız eksik nesneler eklenir; mevcut DB etkilenmez) → 4. satırlar
   * staging'e → 5. tek transaction'da DB değiştirme → 6. yedekte olmayan
   * eski medyayı temizleme (kritik değil; güvenlik yedeğinde olanlarla sınırlı).
   * Başarılı durumu yalnız 1–5 geçtikten sonra yazılır.
   */
  private async executeRestore(ctx: JobContext, source: BackupJobRecord): Promise<RestoreResult> {
    const files = this.requireFiles();
    const uploaded: Array<{ bucket: string; path: string }> = [];
    let staged = false;
    let committed = false;
    let safetyId: string | null = null;
    try {
      await this.beat(ctx, { stage: "validate" }, true);
      const report = await this.inspectPackage(source, true);
      if (!report.ok) throw new StageError("validate", `Yedek doğrulanamadı: ${report.error} Geri yükleme yapılmadı.`);
      const { manifest, tables } = report;

      const currentOwner = await this.db.workspaceOwner();
      const backupOwner = typeof tables.workspace_bootstrap?.[0]?.owner_id === "string" ? String(tables.workspace_bootstrap[0].owner_id) : null;
      if (backupOwner && currentOwner && backupOwner !== currentOwner) {
        throw new StageError("validate", "Bu yedek farklı bir çalışma alanı sahibine ait; geri yükleme yapılmadı.");
      }
      const userIds = new Set<string>();
      for (const table of USER_SCOPED_TABLES) {
        for (const row of tables[table] ?? []) if (typeof row.user_id === "string") userIds.add(row.user_id);
      }
      const missing = await this.db.missingAuthUsers([...userIds]);
      if (missing.length) {
        throw new StageError("validate", `Yedekteki ${missing.length} kullanıcı hesabı bu projede bulunmuyor (Auth kullanıcıları geri yüklenmez); geri yükleme yapılmadı.`);
      }

      await this.beat(ctx, { stage: "safety_backup" }, true);
      let safetyManifest: BackupManifest;
      try {
        const safetyCtx = await this.beginJob({ operation: "backup", kind: "pre_restore", actor: "user", actorUserId: ctx.actorUserId, lockId: ctx.lockId });
        safetyId = safetyCtx.id;
        await this.meta.updateJob(ctx.id, { safetyBackupId: safetyId });
        const safety = await this.executeBackup(safetyCtx, { skipIfUnchanged: false });
        if (safety.status !== "succeeded") throw new Error("güvenlik yedeği tamamlanmadı");
        safetyManifest = safety.manifest;
      } catch (error) {
        throw new StageError("safety_backup", "Geri yükleme öncesi güvenlik yedeği alınamadı; geri yükleme başlatılmadı. Mevcut veriler değiştirilmedi.", error);
      }

      const total = manifest.files.length;
      let done = 0;
      await this.beat(ctx, { stage: "media_staging", done, total }, true);
      const reader = await ZipReader.open(files.filePath(source.fileName!)).catch((error) => {
        throw new StageError("media_staging", "Yedek dosyası okunamadı; geri yükleme yapılmadı.", error);
      });
      try {
        for (const bucket of this.options.buckets) {
          const current = new Map((await this.storage.list(bucket)).map((object) => [object.path, object]));
          for (const file of manifest.files.filter((item) => item.bucket === bucket)) {
            const existing = current.get(file.path);
            if (existing) {
              if (existing.bytes !== file.bytes) {
                throw new StageError("media_staging", `Medya çakışması: ${bucket}/${file.path} mevcut dosyadan farklı. Geri yükleme yapılmadı.`);
              }
            } else {
              const data = await reader.read(file.entry);
              if (sha256(data) !== file.sha256) throw new StageError("media_staging", "Yedekteki medya dosyası bozuk; geri yükleme yapılmadı.");
              await this.storage.upload(bucket, file.path, data, file.contentType);
              uploaded.push({ bucket, path: file.path });
            }
            done += 1;
            await this.beat(ctx, { stage: "media_staging", done, total });
          }
        }
      } catch (error) {
        if (error instanceof StageError) throw error;
        throw new StageError("media_staging", "Medya dosyaları hazırlanamadı; geri yükleme yapılmadı. Mevcut veriler değiştirilmedi.", error);
      } finally {
        await reader.close();
      }

      await this.beat(ctx, { stage: "db_stage" }, true);
      const expected: Record<string, number> = {};
      try {
        await this.db.clearStaging(ctx.id);
        staged = true;
        for (const table of RESTORE_TABLES) {
          const rows = tables[table] ?? [];
          expected[table] = rows.length;
          let batch: Array<{ ord: number; row: TableRow }> = [];
          let bytes = 0;
          for (let ord = 0; ord < rows.length; ord += 1) {
            const size = JSON.stringify(rows[ord]).length;
            if (batch.length && (batch.length >= this.batchRows || bytes + size > this.batchBytes)) {
              await this.db.stageRows(ctx.id, table, batch);
              await this.beat(ctx, { stage: "db_stage" });
              batch = [];
              bytes = 0;
            }
            batch.push({ ord, row: rows[ord] });
            bytes += size;
          }
          if (batch.length) await this.db.stageRows(ctx.id, table, batch);
        }
      } catch (error) {
        if (error instanceof StageError) throw error;
        throw new StageError("db_stage", "Veritabanı satırları hazırlanamadı; geri yükleme yapılmadı. Mevcut veriler değiştirilmedi.", error);
      }

      await this.beat(ctx, { stage: "db_apply" }, true);
      let applied: { counts: Record<string, number>; epoch: string };
      try {
        applied = await this.db.applyRestore(ctx.id, expected);
      } catch (error) {
        // Yanıt ağda kaybolmuş olabilir: RPC aynı transaction'da işi işaretler.
        const job = await this.meta.getJob(ctx.id).catch(() => null);
        if (job?.summary.dbCommittedAt && job.summary.epoch) {
          applied = { counts: job.summary.restoredCounts ?? expected, epoch: job.summary.epoch };
        } else {
          throw new StageError("db_apply", "Veritabanı geri yüklenemedi; tüm değişiklikler geri alındı. Mevcut veriler değiştirilmedi.", error);
        }
      }
      committed = true;
      ctx.summary = { ...ctx.summary, dbCommittedAt: this.now().toISOString(), epoch: applied.epoch, restoredCounts: applied.counts };
      await this.meta.updateJob(ctx.id, { summary: ctx.summary }).catch(() => undefined);

      await this.beat(ctx, { stage: "media_finalize" }, true).catch(() => undefined);
      const warnings: string[] = [];
      let removed = 0;
      try {
        for (const bucket of this.options.buckets) {
          const keep = new Set(manifest.files.filter((file) => file.bucket === bucket).map((file) => file.path));
          const recoverable = new Set(safetyManifest.files.filter((file) => file.bucket === bucket).map((file) => file.path));
          const extra = (await this.storage.list(bucket)).map((object) => object.path).filter((path) => !keep.has(path) && recoverable.has(path));
          if (extra.length) await this.storage.remove(bucket, extra);
          removed += extra.length;
        }
      } catch (error) {
        warnings.push("Geri yüklenen yedekte olmayan bazı eski medya dosyaları silinemedi; çalışma alanı verileri etkilenmez.");
        this.log("restore_media_finalize_failed", { jobId: ctx.id, error: errorText(error) });
      }

      const finishedAt = this.now();
      ctx.summary = {
        ...ctx.summary,
        progress: null,
        mediaUploaded: uploaded.length,
        mediaRemoved: removed,
        warnings,
        durationMs: finishedAt.getTime() - ctx.startedAt.getTime(),
      };
      await this.meta.updateJob(ctx.id, {
        status: "succeeded",
        finishedAt: finishedAt.toISOString(),
        safetyBackupId: safetyId,
        dbRowCount: Object.values(applied.counts).reduce((sum, value) => sum + value, 0),
        mediaFileCount: manifest.files.length,
        summary: ctx.summary,
      });
      this.log("restore_succeeded", { jobId: ctx.id, sourceBackupId: source.id, safetyBackupId: safetyId, uploaded: uploaded.length, removed });
      await this.audit({ action: "restore_succeeded", actor: "user", actorUserId: ctx.actorUserId, jobId: ctx.id, details: { sourceBackupId: source.id, safetyBackupId: safetyId } });
      return { jobId: ctx.id, epoch: applied.epoch, safetyBackupId: safetyId!, warnings };
    } catch (error) {
      const stage = error instanceof StageError ? error.stage : ctx.stage;
      this.log("restore_failed", { jobId: ctx.id, stage, error: errorText(error) });
      if (!committed) {
        if (staged) await this.db.clearStaging(ctx.id).catch((cleanupError) => this.log("restore_cleanup_error", { error: errorText(cleanupError) }));
        for (const bucket of this.options.buckets) {
          const paths = uploaded.filter((item) => item.bucket === bucket).map((item) => item.path);
          if (paths.length) await this.storage.remove(bucket, paths).catch((cleanupError) => this.log("restore_cleanup_error", { error: errorText(cleanupError) }));
        }
      }
      const message = error instanceof StageError
        ? error.userMessage
        : committed
          ? "Veritabanı geri yüklendi ancak işlem kaydı tamamlanamadı."
          : `Geri yükleme "${stageLabel(stage)}" aşamasında başarısız oldu. Mevcut veriler değiştirilmedi.`;
      await this.meta.updateJob(ctx.id, {
        status: "failed",
        errorStage: stage,
        errorMessage: message,
        finishedAt: this.now().toISOString(),
        safetyBackupId: safetyId,
        summary: { ...ctx.summary, progress: null },
      }).catch((updateError) => this.log("job_update_error", { jobId: ctx.id, error: errorText(updateError) }));
      await this.audit({ action: "restore_failed", actor: "user", actorUserId: ctx.actorUserId, jobId: ctx.id, details: { sourceBackupId: source.id, stage } });
      throw new BackupError("failed", message, 500, { jobId: ctx.id, stage });
    } finally {
      await this.meta.releaseLock(ctx.lockId).catch((error) => this.log("lock_release_error", { error: errorText(error) }));
    }
  }

  // ---------------------------------------------------------------
  // Silme, indirme, ayrıntılar, ayarlar, genel görünüm
  // ---------------------------------------------------------------

  async deleteBackup(id: string, userId: string): Promise<void> {
    const job = await this.requireBackupJob(id);
    if (job.operation !== "backup") throw new BackupError("invalid_request", "Yalnız yedek kayıtları silinebilir.", 400);
    if (job.status === "running") throw new BackupError("in_use", "Devam eden bir yedek silinemez.", 409);
    const settings = await this.meta.getSettings();
    if (settings.lockJobId && settings.lockOperation === "restore") {
      const restore = await this.meta.getJob(settings.lockJobId);
      if (restore?.status === "running" && (restore.sourceBackupId === job.id || restore.safetyBackupId === job.id)) {
        throw new BackupError("in_use", "Bu yedek devam eden bir geri yüklemede kullanılıyor; silinemez.", 409);
      }
    }
    if (job.fileName) {
      const files = this.requireFiles();
      await files.remove(job.fileName);
    }
    await this.meta.updateJob(job.id, { deletedAt: this.now().toISOString(), deletedBy: userId, deletedReason: "user" });
    await this.audit({ action: "backup_deleted", actor: "user", actorUserId: userId, jobId: job.id, details: { kind: job.kind, status: job.status } });
  }

  async openDownload(id: string, userId: string): Promise<{ stream: ReadStream; size: number; fileName: string }> {
    const job = await this.requireBackupJob(id);
    if (job.operation !== "backup" || job.status !== "succeeded" || !job.fileName) {
      throw new BackupError("not_restorable", "Yalnız başarıyla tamamlanmış yedekler indirilebilir.", 409);
    }
    const files = this.requireFiles();
    let opened: { stream: ReadStream; size: number };
    try {
      opened = await files.openRead(job.fileName);
    } catch {
      throw new BackupError("not_found", "Yedek dosyası bulunamadı.", 404);
    }
    await this.audit({ action: "backup_downloaded", actor: "user", actorUserId: userId, jobId: job.id });
    return { ...opened, fileName: job.fileName };
  }

  async details(id: string): Promise<BackupDetails> {
    const job = await this.requireBackupJob(id);
    let manifest: BackupDetails["manifest"] = null;
    let fileAvailable = false;
    if (job.operation === "backup" && job.status === "succeeded" && job.fileName && this.options.files && (await this.options.files.exists(job.fileName))) {
      fileAvailable = true;
      let reader: ZipReader | null = null;
      try {
        reader = await ZipReader.open(this.options.files.filePath(job.fileName));
        const parsed = parseManifest(JSON.parse((await reader.read(MANIFEST_ENTRY)).toString("utf8")), this.options.buckets);
        if (parsed.ok) {
          manifest = {
            createdAt: parsed.manifest.createdAt,
            appVersion: parsed.manifest.appVersion,
            schemaVersion: parsed.manifest.schemaVersion,
            tables: parsed.manifest.tables.map((table) => ({ name: table.name, rows: table.rows, restore: table.restore })),
            buckets: parsed.manifest.buckets,
            warnings: parsed.manifest.warnings,
            excluded: parsed.manifest.excluded,
          };
        }
      } catch {
        manifest = null;
      } finally {
        await reader?.close();
      }
    }
    return { job: toJobView(job), manifest, fileAvailable };
  }

  async updateSettings(input: unknown, userId: string): Promise<BackupSettingsView> {
    const parsed = parseBackupSettingsPatch(input);
    if (!parsed.ok) throw new BackupError("invalid_request", parsed.error, 400);
    const settings = await this.meta.updateSettings(parsed.value, userId, this.now());
    await this.audit({ action: "settings_updated", actor: "user", actorUserId: userId, details: { ...parsed.value } });
    return settingsView(settings);
  }

  async overview(): Promise<BackupOverview> {
    await this.recoverStale().catch((error) => this.log("recover_stale_error", { error: errorText(error) }));
    const now = this.now();
    const settings = await this.meta.getSettings();
    const all = await this.meta.listJobs({ includeDeleted: true, limit: 200 });
    const jobs = all.filter((job) => !job.deletedAt).slice(0, 100);
    const lastSuccess = jobs.find((job) => job.operation === "backup" && job.status === "succeeded");
    const lastRegular = all.find((job) => job.operation === "backup" && (job.kind === "manual" || job.kind === "scheduled") && job.status === "succeeded");
    const lastManual = all.find((job) => job.operation === "backup" && job.kind === "manual" && job.status === "succeeded");
    const lastRunAt = latestDate(lastRegular?.startedAt ?? null, settings.lastUnchangedAt);
    const running = jobs.find((job) => job.status === "running" && job.id === settings.lockJobId) ?? jobs.find((job) => job.status === "running") ?? null;
    return {
      settings: settingsView(settings),
      jobs: jobs.map(toJobView),
      running: running ? toJobView(running) : null,
      lastSuccessAt: lastSuccess?.finishedAt ?? null,
      nextAutoAt: nextAutoBackupAt(settings, lastRunAt, now)?.toISOString() ?? null,
      cronLastSeenAt: settings.cronLastSeenAt,
      cronConfigured: Boolean(this.options.cronConfigured),
      cooldownUntil: manualCooldownUntil(lastManual ? new Date(lastManual.finishedAt ?? lastManual.startedAt) : null, now)?.toISOString() ?? null,
      totalBytes: jobs.filter((job) => job.operation === "backup" && job.status === "succeeded").reduce((sum, job) => sum + (job.sizeBytes ?? 0), 0),
      storage: { ok: Boolean(this.options.files), error: this.options.files ? null : this.options.storageError ?? "Yedek dizini yapılandırılmamış." },
    };
  }
}

function latestDate(...values: Array<string | null | undefined>): Date | null {
  const times = values.filter((value): value is string => Boolean(value)).map((value) => Date.parse(value)).filter((time) => Number.isFinite(time));
  return times.length ? new Date(Math.max(...times)) : null;
}
