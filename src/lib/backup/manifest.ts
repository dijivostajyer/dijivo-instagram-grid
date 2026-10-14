import { UUID_RE, type BackupKind } from "./shared";

/**
 * Yedek paketi biçimi (v1):
 *
 *   manifest.json                     → BackupManifest (en son yazılır)
 *   database/<tablo>.json             → satır dizisi (to_jsonb çıktısı)
 *   storage/<bucket>/<nesne yolu>     → medya dosyasının birebir içeriği
 *
 * Her girdinin SHA-256'sı ve boyutu manifest'te, CRC32'si ZIP dizinindedir.
 */
export const BACKUP_FORMAT = "dijivo-grid-backup";
export const BACKUP_FORMAT_VERSION = 1;
/** Uygulamanın bildiği en yeni migration; daha yeni şemalı yedek geri yüklenmez. */
export const BACKUP_SCHEMA_VERSION = "20261014160000";
export const MANIFEST_ENTRY = "manifest.json";

/** Geri yüklenen tablolar; ebeveyn → çocuk sırası (silme tersten yapılır). */
export const RESTORE_TABLES = [
  "workspace_brands",
  "workspace_projects",
  "workspace_posts",
  "workspace_highlights",
  "workspace_stories",
  "workspace_prefs",
  "calendar_items",
  "share_snapshots",
  "share_feedback",
  "share_feedback_workflow_events",
] as const;

/**
 * Yalnız kayıt/denetim için pakete giren, geri YÜKLENMEYEN tablolar:
 * - instagram_import_jobs: geçici iş durumu; eski "preparing" işi geri
 *   gelirse yanlış yoklamaya yol açar. Mevcut satırlara dokunulmaz.
 * - workspace_bootstrap: auth.users'a bağlı ilk hesap kilidi; geri yükleme
 *   yalnız aynı sahip için yapılır, satır değiştirilmez.
 */
export const AUDIT_ONLY_TABLES = ["instagram_import_jobs", "workspace_bootstrap"] as const;

export const BACKUP_TABLES = [...RESTORE_TABLES, ...AUDIT_ONLY_TABLES] as const;
export type BackupTable = (typeof BACKUP_TABLES)[number];
export type RestoreTable = (typeof RESTORE_TABLES)[number];

/** user_id taşıyan (auth.users'a FK'li) geri yükleme tabloları. */
export const USER_SCOPED_TABLES: readonly RestoreTable[] = [
  "workspace_brands",
  "workspace_projects",
  "workspace_posts",
  "workspace_highlights",
  "workspace_stories",
  "workspace_prefs",
  "share_feedback",
  "share_feedback_workflow_events",
];

/** Bilerek pakete ALINMAYANLAR (manifest'te de listelenir). */
export const BACKUP_EXCLUDED = [
  "auth.users ve oturumlar (Supabase Auth ayrı sistemdir)",
  "Supabase Vault sırları",
  ".env ve sunucu ortam değişkenleri (Supabase service key, Bright Data API key, BACKUP_CRON_SECRET)",
  "backup_* yönetim tabloları ve yedek dosyaları",
] as const;

/** Paket içi göreli yol: ileri eğik çizgi; `..`, `.`, boş parça, mutlak veya sürücü yolu yok. */
export function isSafeArchivePath(name: string): boolean {
  if (!name || name.length > 1024 || name.startsWith("/") || name.includes("\\") || name.includes("\0")) return false;
  if (/^[A-Za-z]:/.test(name)) return false;
  return name.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}

export const tableEntry = (table: string) => `database/${table}.json`;
export const fileEntry = (bucket: string, path: string) => `storage/${bucket}/${path}`;

export interface ManifestTable {
  name: BackupTable;
  entry: string;
  rows: number;
  bytes: number;
  sha256: string;
  restore: boolean;
}

export interface ManifestFile {
  bucket: string;
  path: string;
  entry: string;
  bytes: number;
  sha256: string;
  contentType: string | null;
}

export interface BackupManifest {
  format: typeof BACKUP_FORMAT;
  formatVersion: number;
  backupId: string;
  kind: BackupKind;
  createdAt: string;
  completedAt: string;
  appVersion: string;
  schemaVersion: string;
  complete: true;
  /** Tablo verisi + medya listesinden türetilen parmak izi (değişiklik yoksa otomatik yedek atlanır). */
  fingerprint: string;
  tables: ManifestTable[];
  buckets: Array<{ name: string; files: number; bytes: number }>;
  files: ManifestFile[];
  totals: { rows: number; files: number; mediaBytes: number };
  warnings: string[];
  excluded: string[];
}

const SHA_RE = /^[0-9a-f]{64}$/;
const isCount = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0;
const isIso = (value: unknown): value is string => typeof value === "string" && !Number.isNaN(Date.parse(value));

/** manifest.json içeriğini katı biçimde doğrular. */
export function parseManifest(value: unknown, allowedBuckets: readonly string[]): { ok: true; manifest: BackupManifest } | { ok: false; error: string } {
  const fail = (error: string) => ({ ok: false as const, error });
  if (typeof value !== "object" || value === null || Array.isArray(value)) return fail("Manifest geçersiz.");
  const m = value as Record<string, unknown>;
  if (m.format !== BACKUP_FORMAT) return fail("Bu dosya bir Dijivo Grid yedeği değil.");
  if (typeof m.formatVersion !== "number" || !Number.isInteger(m.formatVersion) || m.formatVersion < 1) return fail("Yedek sürümü geçersiz.");
  if (m.formatVersion > BACKUP_FORMAT_VERSION) return fail("Bu yedek daha yeni bir uygulama sürümüyle alınmış; desteklenmiyor.");
  if (typeof m.backupId !== "string" || !UUID_RE.test(m.backupId)) return fail("Manifest yedek kimliği geçersiz.");
  if (m.kind !== "manual" && m.kind !== "scheduled" && m.kind !== "pre_restore") return fail("Manifest yedek türü geçersiz.");
  if (!isIso(m.createdAt) || !isIso(m.completedAt)) return fail("Manifest tarihleri geçersiz.");
  if (typeof m.schemaVersion !== "string" || !/^\d{12,14}$/.test(m.schemaVersion)) return fail("Manifest şema sürümü geçersiz.");
  if (m.complete !== true) return fail("Yedek tamamlanmamış.");
  if (typeof m.fingerprint !== "string" || !SHA_RE.test(m.fingerprint)) return fail("Manifest parmak izi geçersiz.");
  if (typeof m.appVersion !== "string") return fail("Manifest uygulama sürümü geçersiz.");
  if (!Array.isArray(m.tables) || !Array.isArray(m.files) || !Array.isArray(m.buckets)) return fail("Manifest listeleri eksik.");
  if (!Array.isArray(m.warnings) || !Array.isArray(m.excluded)) return fail("Manifest listeleri eksik.");

  const entries = new Set<string>();
  const tables: ManifestTable[] = [];
  for (const raw of m.tables) {
    const t = raw as Record<string, unknown>;
    if (!t || typeof t.name !== "string" || !(BACKUP_TABLES as readonly string[]).includes(t.name)) return fail("Manifest tablo listesi geçersiz.");
    if (t.entry !== tableEntry(t.name) || !isCount(t.rows) || !isCount(t.bytes) || typeof t.sha256 !== "string" || !SHA_RE.test(t.sha256)) {
      return fail(`Manifest tablo kaydı geçersiz: ${t.name}`);
    }
    if (entries.has(t.entry)) return fail(`Manifest tablo tekrarı: ${t.name}`);
    entries.add(t.entry);
    tables.push({ name: t.name as BackupTable, entry: t.entry, rows: t.rows, bytes: t.bytes, sha256: t.sha256, restore: (RESTORE_TABLES as readonly string[]).includes(t.name) });
  }
  for (const table of RESTORE_TABLES) {
    if (!tables.some((entry) => entry.name === table)) return fail(`Yedekte beklenen tablo yok: ${table}`);
  }

  const files: ManifestFile[] = [];
  for (const raw of m.files) {
    const f = raw as Record<string, unknown>;
    if (!f || typeof f.bucket !== "string" || !allowedBuckets.includes(f.bucket)) return fail("Manifest medya kaydı bilinmeyen bir depoya ait.");
    if (typeof f.path !== "string" || !isSafeArchivePath(f.path)) return fail("Manifest medya yolu güvensiz.");
    if (f.entry !== fileEntry(f.bucket, f.path) || !isCount(f.bytes) || typeof f.sha256 !== "string" || !SHA_RE.test(f.sha256)) {
      return fail(`Manifest medya kaydı geçersiz: ${f.bucket}/${f.path}`);
    }
    if (f.contentType !== null && typeof f.contentType !== "string") return fail("Manifest medya türü geçersiz.");
    if (entries.has(f.entry)) return fail(`Manifest medya tekrarı: ${f.entry}`);
    entries.add(f.entry);
    files.push({ bucket: f.bucket, path: f.path, entry: f.entry, bytes: f.bytes, sha256: f.sha256, contentType: (f.contentType as string | null) ?? null });
  }

  const buckets = (m.buckets as Array<Record<string, unknown>>).map((b) => ({ name: String(b?.name ?? ""), files: Number(b?.files ?? 0), bytes: Number(b?.bytes ?? 0) }));
  const totals = m.totals as Record<string, unknown> | undefined;
  return {
    ok: true,
    manifest: {
      format: BACKUP_FORMAT,
      formatVersion: m.formatVersion,
      backupId: m.backupId.toLowerCase(),
      kind: m.kind,
      createdAt: m.createdAt,
      completedAt: m.completedAt,
      appVersion: m.appVersion,
      schemaVersion: m.schemaVersion,
      complete: true,
      fingerprint: m.fingerprint,
      tables,
      buckets,
      files,
      totals: { rows: Number(totals?.rows ?? 0), files: Number(totals?.files ?? files.length), mediaBytes: Number(totals?.mediaBytes ?? 0) },
      warnings: m.warnings.filter((warning): warning is string => typeof warning === "string"),
      excluded: m.excluded.filter((item): item is string => typeof item === "string"),
    },
  };
}
