/**
 * Yedekleme merkezinin istemci ve sunucuda ortak, saf (yan etkisiz) parçaları:
 * tipler, periyot seçenekleri, zamanlama/cooldown hesapları, saklama
 * politikası ve Türkçe etiketler. Node modülü içe aktarmaz.
 */

export type BackupKind = "manual" | "scheduled" | "pre_restore";
export type BackupJobKind = BackupKind | "restore";
export type BackupOperation = "backup" | "restore";
export type BackupStatus = "running" | "succeeded" | "failed";
export type BackupActor = "user" | "cron";

export interface BackupProgress {
  stage: string;
  done?: number;
  total?: number;
}

/** API'nin istemciye döndürdüğü iş görünümü (dosya yolu İÇERMEZ). */
export interface BackupJobView {
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
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  errorStage: string | null;
  errorMessage: string | null;
  sourceBackupId: string | null;
  safetyBackupId: string | null;
  progress: BackupProgress | null;
  warnings: string[];
  /** Başarılı, silinmemiş ve dosyası olan yedek geri yüklenebilir. */
  restorable: boolean;
  /** Geri yükleme başarıyla bittiyse istemcinin yerel önbelleği için epoch. */
  restoreEpoch: string | null;
}

export interface BackupSettingsView {
  autoEnabled: boolean;
  intervalMinutes: number;
  keepLast: number;
  keepDailyDays: number;
  keepWeeklyWeeks: number;
  keepPreRestoreDays: number;
  updatedAt: string | null;
}

export interface BackupOverview {
  settings: BackupSettingsView;
  jobs: BackupJobView[];
  running: BackupJobView | null;
  lastSuccessAt: string | null;
  nextAutoAt: string | null;
  cronLastSeenAt: string | null;
  cronConfigured: boolean;
  cooldownUntil: string | null;
  totalBytes: number;
  storage: { ok: boolean; error: string | null };
}

export interface BackupDetails {
  job: BackupJobView;
  manifest: {
    createdAt: string;
    appVersion: string;
    schemaVersion: string;
    tables: Array<{ name: string; rows: number; restore: boolean }>;
    buckets: Array<{ name: string; files: number; bytes: number }>;
    warnings: string[];
    excluded: string[];
  } | null;
  fileAvailable: boolean;
}

export interface BackupValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

// -----------------------------------------------------------------
// Periyotlar ve zamanlama
// -----------------------------------------------------------------

/** Tam (DB + medya) yedek için izinli periyotlar. 15 dakikanın altı YOK. */
export const BACKUP_INTERVALS: ReadonlyArray<{ minutes: number; label: string }> = [
  { minutes: 15, label: "15 dakika" },
  { minutes: 30, label: "30 dakika" },
  { minutes: 60, label: "1 saat" },
  { minutes: 180, label: "3 saat" },
  { minutes: 360, label: "6 saat" },
  { minutes: 720, label: "12 saat" },
  { minutes: 1440, label: "Günlük" },
  { minutes: 10080, label: "Haftalık" },
];
export const MIN_BACKUP_INTERVAL_MINUTES = 15;
export const MANUAL_BACKUP_COOLDOWN_MS = 5 * 60_000;
/**
 * Cron 15 dakikada bir tetikler; tetik saati birkaç saniye kayabilir.
 * Önceki yedeğin başlangıcına göre hesaplanır ve bu pay kadar erken
 * çalışmaya izin verilir (aksi halde 15 dk'lık ayar 30 dk'ya kayardı).
 */
export const SCHEDULE_GRACE_MS = 2 * 60_000;

export function isAllowedInterval(minutes: unknown): minutes is number {
  return typeof minutes === "number" && BACKUP_INTERVALS.some((option) => option.minutes === minutes);
}

export function intervalLabel(minutes: number): string {
  return BACKUP_INTERVALS.find((option) => option.minutes === minutes)?.label ?? `${minutes} dakika`;
}

/** Sonraki otomatik yedek zamanı; kapalıysa null, hiç yedek yoksa "şimdi". */
export function nextAutoBackupAt(settings: Pick<BackupSettingsView, "autoEnabled" | "intervalMinutes">, lastRunAt: Date | null, now: Date): Date | null {
  if (!settings.autoEnabled) return null;
  if (!lastRunAt) return now;
  return new Date(lastRunAt.getTime() + settings.intervalMinutes * 60_000);
}

/** Cron çağrısında: otomatik yedek zamanı geldi mi? */
export function isBackupDue(settings: Pick<BackupSettingsView, "autoEnabled" | "intervalMinutes">, lastRunAt: Date | null, now: Date): boolean {
  if (!settings.autoEnabled) return false;
  if (!lastRunAt) return true;
  return now.getTime() >= lastRunAt.getTime() + settings.intervalMinutes * 60_000 - SCHEDULE_GRACE_MS;
}

/** Manuel yedek cooldown'u yalnız BAŞARILI son manuel yedekten sayılır. */
export function manualCooldownUntil(lastManualSuccessAt: Date | null, now: Date): Date | null {
  if (!lastManualSuccessAt) return null;
  const until = new Date(lastManualSuccessAt.getTime() + MANUAL_BACKUP_COOLDOWN_MS);
  return until.getTime() > now.getTime() ? until : null;
}

// -----------------------------------------------------------------
// Saklama politikası (retention)
// -----------------------------------------------------------------

export interface RetentionPolicy {
  keepLast: number;
  keepDailyDays: number;
  keepWeeklyWeeks: number;
  keepPreRestoreDays: number;
}

export interface RetentionCandidate {
  id: string;
  kind: BackupKind;
  /** Yedeğin alındığı an (başlangıç). */
  takenAt: string;
}

const DAY_MS = 24 * 60 * 60_000;

function localDateParts(date: Date, timeZone: string): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day") };
}

function isoWeekKey(year: number, month: number, day: number): string {
  const date = new Date(Date.UTC(year, month - 1, day));
  const weekday = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - weekday);
  const weekYear = date.getUTCFullYear();
  const week = Math.ceil(((date.getTime() - Date.UTC(weekYear, 0, 1)) / DAY_MS + 1) / 7);
  return `${weekYear}-W${String(week).padStart(2, "0")}`;
}

/**
 * Silinecek yedekleri seçer (yalnız başarılı, silinmemiş yedekler verilir).
 *
 * Manuel + otomatik: en yeni `keepLast` adet; son `keepDailyDays` gün için
 * her günün en yenisi; son `keepWeeklyWeeks` hafta için her ISO haftanın en
 * yenisi tutulur. Geri yükleme öncesi yedekler ayrı değerlendirilir:
 * `keepPreRestoreDays` günden yeni olanlar ve her durumda EN YENİSİ tutulur.
 * `protectedIds` (az önce alınan yedek, devam eden işin kaynağı) asla silinmez.
 */
export function selectRetentionDeletes(
  backups: readonly RetentionCandidate[],
  policy: RetentionPolicy,
  now: Date,
  protectedIds: ReadonlySet<string> = new Set(),
  timeZone = "Europe/Istanbul",
): string[] {
  const newestFirst = (list: RetentionCandidate[]) =>
    [...list].sort((a, b) => b.takenAt.localeCompare(a.takenAt) || b.id.localeCompare(a.id));
  const keep = new Set<string>(protectedIds);

  const regular = newestFirst(backups.filter((backup) => backup.kind !== "pre_restore"));
  regular.slice(0, Math.max(1, policy.keepLast)).forEach((backup) => keep.add(backup.id));
  const days = new Set<string>();
  const weeks = new Set<string>();
  for (const backup of regular) {
    const taken = new Date(backup.takenAt);
    const age = now.getTime() - taken.getTime();
    const { year, month, day } = localDateParts(taken, timeZone);
    const dayKey = `${year}-${month}-${day}`;
    if (age < policy.keepDailyDays * DAY_MS && !days.has(dayKey)) {
      days.add(dayKey);
      keep.add(backup.id);
    }
    const weekKey = isoWeekKey(year, month, day);
    if (age < policy.keepWeeklyWeeks * 7 * DAY_MS && !weeks.has(weekKey)) {
      weeks.add(weekKey);
      keep.add(backup.id);
    }
  }

  const preRestore = newestFirst(backups.filter((backup) => backup.kind === "pre_restore"));
  if (preRestore[0]) keep.add(preRestore[0].id);
  for (const backup of preRestore) {
    if (now.getTime() - new Date(backup.takenAt).getTime() < policy.keepPreRestoreDays * DAY_MS) keep.add(backup.id);
  }

  return backups.filter((backup) => !keep.has(backup.id)).map((backup) => backup.id);
}

// -----------------------------------------------------------------
// Ayar güncellemesi doğrulama
// -----------------------------------------------------------------

export type BackupSettingsPatch = Partial<Omit<BackupSettingsView, "updatedAt">>;

const RETENTION_LIMITS: Record<"keepLast" | "keepDailyDays" | "keepWeeklyWeeks" | "keepPreRestoreDays", [number, number]> = {
  keepLast: [1, 100],
  keepDailyDays: [0, 90],
  keepWeeklyWeeks: [0, 52],
  keepPreRestoreDays: [1, 90],
};

export function parseBackupSettingsPatch(input: unknown): { ok: true; value: BackupSettingsPatch } | { ok: false; error: string } {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return { ok: false, error: "Geçersiz istek." };
  const body = input as Record<string, unknown>;
  const value: BackupSettingsPatch = {};
  if ("autoEnabled" in body) {
    if (typeof body.autoEnabled !== "boolean") return { ok: false, error: "Otomatik yedekleme değeri geçersiz." };
    value.autoEnabled = body.autoEnabled;
  }
  if ("intervalMinutes" in body) {
    if (!isAllowedInterval(body.intervalMinutes)) return { ok: false, error: "Geçersiz yedekleme periyodu. En kısa periyot 15 dakikadır." };
    value.intervalMinutes = body.intervalMinutes;
  }
  for (const key of Object.keys(RETENTION_LIMITS) as Array<keyof typeof RETENTION_LIMITS>) {
    if (!(key in body)) continue;
    const [min, max] = RETENTION_LIMITS[key];
    const raw = body[key];
    if (typeof raw !== "number" || !Number.isInteger(raw) || raw < min || raw > max) {
      return { ok: false, error: `Saklama ayarı ${min}–${max} aralığında olmalı.` };
    }
    value[key] = raw;
  }
  if (Object.keys(value).length === 0) return { ok: false, error: "Değiştirilecek ayar yok." };
  return { ok: true, value };
}

// -----------------------------------------------------------------
// Türkçe etiketler ve biçimlendirme
// -----------------------------------------------------------------

export const BACKUP_KIND_LABELS: Record<BackupJobKind, string> = {
  manual: "Manuel",
  scheduled: "Otomatik",
  pre_restore: "Geri yükleme öncesi",
  restore: "Geri yükleme",
};

export const BACKUP_STATUS_LABELS: Record<BackupStatus, string> = {
  running: "Devam ediyor",
  succeeded: "Başarılı",
  failed: "Başarısız",
};

export const BACKUP_STAGE_LABELS: Record<string, string> = {
  prepare: "Hazırlık",
  export_db: "Veritabanı dışa aktarma",
  list_media: "Medya listeleme",
  download_media: "Medya paketleme",
  write_package: "Paket yazma",
  verify_package: "Paket doğrulama",
  finalize: "Paketi tamamlama",
  validate: "Yedek doğrulama",
  safety_backup: "Geri yükleme öncesi yedek",
  media_staging: "Medya hazırlama",
  db_stage: "Veritabanı hazırlama",
  db_apply: "Veritabanı geri yükleme",
  media_finalize: "Medya son temizlik",
  interrupted: "Yarıda kesildi",
};

export function stageLabel(stage: string | null | undefined): string {
  if (!stage) return "";
  return BACKUP_STAGE_LABELS[stage] ?? stage;
}

/** "14 Ekim 2026, 14:30" (kullanıcının yerel saatiyle). */
export function formatBackupDateTime(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const day = date.toLocaleDateString("tr-TR", { day: "numeric", month: "long", year: "numeric" });
  const time = date.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
  return `${day}, ${time}`;
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = unit === 0 || value >= 100 ? 0 : 1;
  return `${value.toLocaleString("tr-TR", { maximumFractionDigits: digits, minimumFractionDigits: 0 })} ${units[unit]}`;
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) return "—";
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds} sn`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes < 60) return rest ? `${minutes} dk ${rest} sn` : `${minutes} dk`;
  const hours = Math.floor(minutes / 60);
  return `${hours} sa ${minutes % 60} dk`;
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
