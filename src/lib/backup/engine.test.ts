import { mkdtemp, readdir, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { BackupEngine, BackupError, toJobView } from "./engine";
import { FileSystemBackupStore } from "./files";
import { BACKUP_TABLES, MANIFEST_ENTRY, RESTORE_TABLES, type BackupManifest } from "./manifest";
import { InMemoryBackupDatabase, InMemoryBackupMetaStore, InMemoryBackupStorage } from "./memory";
import type { TableRow } from "./types";
import { ZipReader, ZipWriter } from "./zip";

const OWNER = "00000000-0000-4000-8000-000000000001";
const STRANGER = "99999999-9999-4999-8999-999999999999";
const T_EXPIRED = "11111111-1111-4111-8111-111111111111";
const T_ACTIVE = "22222222-2222-4222-8222-222222222222";
const BUCKETS = ["workspace-media", "share-images", "share-media"] as const;

function fixtureTables(): Record<string, TableRow[]> {
  return {
    workspace_brands: [{ user_id: OWNER, id: "b1", name: "Moda Butik", username: "modabutik", hashtag_groups: [], created_at: "2026-10-01T09:00:00.000Z" }],
    workspace_projects: [{ user_id: OWNER, id: "p1", brand_id: "b1", name: "Ekim", month: 10, year: 2026 }],
    workspace_posts: [
      { user_id: OWNER, id: "post1", brand_id: "b1", project_id: "p1", source: "planlanan", plan_order: 0, recency_index: null, image_path: `storage:workspace-media/${OWNER}/a.jpg`, caption: "İlk gönderi", grid_order: 0 },
      { user_id: OWNER, id: "post2", brand_id: "b1", project_id: "p1", source: "planlanan", plan_order: 1, recency_index: null, image_path: `storage:workspace-media/${OWNER}/b.jpg`, caption: "İkinci", grid_order: 1 },
    ],
    workspace_highlights: [{ user_id: OWNER, id: "h1", brand_id: "b1", title: "Yeni" }],
    workspace_stories: [{ user_id: OWNER, id: "s1", brand_id: "b1", project_id: "p1", media_type: "image", media_path: `${OWNER}/s.jpg`, sort_order: 0 }],
    workspace_prefs: [{ user_id: OWNER, active_brand_id: "b1", active_project_id: "p1" }],
    calendar_items: [{ id: "c0c0c0c0-0000-4000-8000-000000000001", brand_id: "b1", project_id: "p1", item_type: "post", title: "Gönderi", scheduled_at: "2026-10-20T09:00:00.000Z", status: "planned" }],
    share_snapshots: [
      { token: T_EXPIRED, version: 1, created_at: "2026-09-01T00:00:00.000Z", expires_at: "2026-10-01T00:00:00.000Z", revoked_at: null, payload: { posts: [] } },
      { token: T_ACTIVE, version: 1, created_at: "2026-10-10T00:00:00.000Z", expires_at: "2026-11-09T00:00:00.000Z", revoked_at: null, payload: { posts: [] } },
    ],
    share_feedback: [{ id: "f0f0f0f0-0000-4000-8000-000000000001", share_token: T_ACTIVE, user_id: OWNER, target_type: "post", target_id: "post1", action: "approved", client_name: "Ayşe", read_at: null, workflow_status: "new" }],
    share_feedback_workflow_events: [],
    instagram_import_jobs: [{ id: "a0a0a0a0-0000-4000-8000-000000000001", user_id: OWNER, username: "modabutik", snapshot_id: "snap-1", status: "ready" }],
    workspace_bootstrap: [{ id: true, owner_id: OWNER, created_at: "2026-09-01T00:00:00.000Z" }],
  };
}

const SECRETS = {
  SUPABASE_SECRET_KEY: "sb_secret_TEST_DO_NOT_LEAK_0123456789",
  INSTAGRAM_PROVIDER_API_KEY: "brightdata_TEST_DO_NOT_LEAK_abcdef",
  BACKUP_CRON_SECRET: "cron_TEST_DO_NOT_LEAK_secret_value_123456",
};

let dir: string;
let clock: Date;
let db: InMemoryBackupDatabase;
let storage: InMemoryBackupStorage;
let meta: InMemoryBackupMetaStore;
let files: FileSystemBackupStore;
let engine: BackupEngine;
const logs: Array<{ event: string; details: Record<string, unknown> }> = [];

function makeEngine(overrides: Partial<ConstructorParameters<typeof BackupEngine>[0]> = {}) {
  return new BackupEngine({
    db, storage, meta, files, buckets: BUCKETS, appVersion: "0.1.0", now: () => new Date(clock), heartbeatMs: 0,
    logger: (event, details) => logs.push({ event, details }),
    ...overrides,
  });
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "dijivo-backup-test-"));
  clock = new Date("2026-10-14T11:30:00.000Z");
  db = new InMemoryBackupDatabase(fixtureTables(), [OWNER]);
  storage = new InMemoryBackupStorage(BUCKETS);
  storage.put("workspace-media", `${OWNER}/a.jpg`, "jpeg-a-bytes", "image/jpeg");
  storage.put("workspace-media", `${OWNER}/b.jpg`, "jpeg-b-bytes", "image/jpeg");
  storage.put("workspace-media", `${OWNER}/s.jpg`, "story-bytes", "image/jpeg");
  storage.put("share-images", `shares/${T_ACTIVE}/0-abc.jpg`, "share-image", "image/jpeg");
  storage.put("share-media", `media/${T_ACTIVE}/0-def.mp4`, "share-video-bytes", "video/mp4");
  meta = new InMemoryBackupMetaStore();
  files = new FileSystemBackupStore(dir);
  logs.length = 0;
  engine = makeEngine();
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function manualBackup(userId = OWNER) {
  const { job, completion } = await engine.startManualBackup(userId);
  const result = await completion;
  return { job, result, record: (await meta.getJob(job.id))! };
}

async function readPackage(fileName: string) {
  const reader = await ZipReader.open(files.filePath(fileName));
  const entries = reader.entries().map((entry) => entry.name);
  const manifest = JSON.parse((await reader.read(MANIFEST_ENTRY)).toString("utf8")) as BackupManifest;
  const read = async (name: string) => reader.read(name);
  return { reader, entries, manifest, read };
}

/** Paketi verilen dönüşümle yeniden yazar (bozuk/kurcalanmış yedek senaryoları). */
async function rewritePackage(fileName: string, transform: (name: string, data: Buffer) => Buffer | null, extra: Array<[string, string]> = []) {
  const original = await readPackage(fileName);
  const contents: Array<[string, Buffer]> = [];
  for (const name of original.entries) {
    const next = transform(name, await original.read(name));
    if (next) contents.push([name, next]);
  }
  await original.reader.close();
  await unlink(files.filePath(fileName));
  const writer = await ZipWriter.create(files.filePath(fileName));
  for (const [name, data] of contents) await writer.add(name, data, { compress: name.endsWith(".json") });
  for (const [name, data] of extra) await writer.add(name, Buffer.from(data));
  await writer.close();
}

async function restore(sourceId: string) {
  const { job, completion } = await engine.startRestore(sourceId, OWNER);
  const outcome = await completion.then((value) => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error: error as BackupError }));
  return { job, outcome, record: (await meta.getJob(job.id))! };
}

function mutateWorkspace() {
  db.tables.workspace_brands.push({ user_id: OWNER, id: "b2", name: "Yeni Marka", username: "yeni" });
  db.tables.workspace_posts = db.tables.workspace_posts.filter((post) => post.id !== "post2");
  db.tables.workspace_posts[0].caption = "Değiştirilmiş başlık";
  db.tables.share_feedback[0].read_at = "2026-10-14T12:00:00.000Z";
  db.tables.share_snapshots = db.tables.share_snapshots.filter((share) => share.token !== T_EXPIRED);
  storage.buckets.get("workspace-media")!.delete(`${OWNER}/b.jpg`);
  storage.put("workspace-media", `${OWNER}/new.jpg`, "new-upload", "image/jpeg");
}

describe("manuel yedek", () => {
  it("A. Şimdi Yedekle: iş hemen 'Devam ediyor' döner, tamamlanınca dosya oluşur", async () => {
    const { job, completion } = await engine.startManualBackup(OWNER);
    expect(job).toMatchObject({ kind: "manual", status: "running", actor: "user", actorUserId: OWNER, restorable: false });
    const result = await completion;
    expect(result.status).toBe("succeeded");
    const record = (await meta.getJob(job.id))!;
    expect(record.status).toBe("succeeded");
    expect(record.fileName).toMatch(/^backup-2026-10-14-113000-[0-9a-f]{8}\.zip$/);
    expect(await readdir(dir)).toEqual([record.fileName]);
    expect(meta.settings.lockJobId).toBeNull();
  });

  it("B. manifest: kimlik, UTC tarih, sürüm, tür, tamamlandı, sayılar, sağlama toplamları", async () => {
    const { record } = await manualBackup();
    const { manifest, reader } = await readPackage(record.fileName!);
    await reader.close();
    expect(manifest).toMatchObject({
      format: "dijivo-grid-backup", formatVersion: 1, backupId: record.id, kind: "manual", createdAt: "2026-10-14T11:30:00.000Z",
      appVersion: "0.1.0", schemaVersion: "20261014160000", complete: true,
      totals: { rows: 13, files: 5, mediaBytes: 63 },
    });
    expect(manifest.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest.buckets).toEqual([
      { name: "workspace-media", files: 3, bytes: 35 },
      { name: "share-images", files: 1, bytes: 11 },
      { name: "share-media", files: 1, bytes: 17 },
    ]);
    expect(manifest.tables.every((table) => /^[0-9a-f]{64}$/.test(table.sha256) && table.bytes > 0)).toBe(true);
    expect(manifest.excluded.join(" ")).toMatch(/auth\.users/);
  });

  it("C. tüm DB tabloları pakette; satır sayıları manifest ile aynı; yalnız geri yükleme tabloları restore=true", async () => {
    const { record } = await manualBackup();
    const pkg = await readPackage(record.fileName!);
    for (const table of BACKUP_TABLES) {
      expect(pkg.entries).toContain(`database/${table}.json`);
      const rows = JSON.parse((await pkg.read(`database/${table}.json`)).toString("utf8"));
      expect(rows).toEqual(fixtureTables()[table]);
      expect(pkg.manifest.tables.find((item) => item.name === table)).toMatchObject({ rows: rows.length, restore: (RESTORE_TABLES as readonly string[]).includes(table) });
    }
    expect(pkg.manifest.tables.find((item) => item.name === "instagram_import_jobs")?.restore).toBe(false);
    expect(pkg.manifest.tables.find((item) => item.name === "workspace_bootstrap")?.restore).toBe(false);
    await pkg.reader.close();
  });

  it("D. medya pakette (3 bucket), içerik ve SHA-256 birebir", async () => {
    const { record } = await manualBackup();
    const pkg = await readPackage(record.fileName!);
    expect(pkg.entries.filter((name) => name.startsWith("storage/")).sort()).toEqual([
      `storage/share-images/shares/${T_ACTIVE}/0-abc.jpg`,
      `storage/share-media/media/${T_ACTIVE}/0-def.mp4`,
      `storage/workspace-media/${OWNER}/a.jpg`,
      `storage/workspace-media/${OWNER}/b.jpg`,
      `storage/workspace-media/${OWNER}/s.jpg`,
    ]);
    expect((await pkg.read(`storage/share-media/media/${T_ACTIVE}/0-def.mp4`)).toString()).toBe("share-video-bytes");
    expect(pkg.manifest.files.find((file) => file.path === `${OWNER}/a.jpg`)).toMatchObject({ bucket: "workspace-media", bytes: 12, contentType: "image/jpeg" });
    await pkg.reader.close();
  });

  it("E. .env / service key / Bright Data key / cron secret pakette YOK", async () => {
    const previous = { ...process.env };
    Object.assign(process.env, SECRETS);
    try {
      const { record } = await manualBackup();
      const bytes = await readFile(files.filePath(record.fileName!));
      const pkg = await readPackage(record.fileName!);
      const contents = Buffer.concat(await Promise.all(pkg.entries.map((name) => pkg.read(name)))).toString("utf8");
      await pkg.reader.close();
      for (const secret of Object.values(SECRETS)) {
        expect(bytes.includes(Buffer.from(secret))).toBe(false);
        expect(contents.includes(secret)).toBe(false);
      }
      expect(pkg.entries.every((name) => name === "manifest.json" || name.startsWith("database/") || name.startsWith("storage/"))).toBe(true);
      expect(pkg.entries.some((name) => /(^|\/)\.env/.test(name))).toBe(false);
      // Manifest yalnız hariç tutulanların ADINI yazar; hiçbir env ataması/değeri yoktur.
      expect(contents).not.toMatch(/(SUPABASE_SECRET_KEY|BACKUP_CRON_SECRET|INSTAGRAM_PROVIDER_API_KEY)s*=/);
    } finally {
      process.env = previous;
    }
  });

  it("F. aynı anda ikinci yedek (manuel veya zamanlanmış) sunucu kilidiyle reddedilir", async () => {
    const first = await engine.startManualBackup(OWNER);
    await expect(engine.startManualBackup(OWNER)).rejects.toMatchObject({ code: "busy", status: 409 });
    meta.settings.intervalMinutes = 15;
    expect(await engine.runScheduled()).toEqual({ status: "busy" });
    await first.completion;
    expect([...meta.jobs.values()].filter((job) => job.operation === "backup")).toHaveLength(1);
  });

  it("G. bayat kilit (process yeniden başladı) temizlenir; yarım iş 'başarısız' olur, yeni yedek çalışır", async () => {
    const orphanId = "dddddddd-0000-4000-8000-000000000001";
    const twentyMinutesAgo = new Date(clock.getTime() - 20 * 60_000).toISOString();
    await meta.createJob({ id: orphanId, operation: "backup", kind: "scheduled", actor: "cron", actorUserId: null, startedAt: twentyMinutesAgo });
    meta.settings = { ...meta.settings, lockJobId: orphanId, lockOperation: "backup", lockHeartbeatAt: twentyMinutesAgo, lockAcquiredAt: twentyMinutesAgo };
    await writeFile(path.join(dir, "backup-2026-10-14-111000-dddddddd.zip.partial"), "yarım");

    const { record } = await manualBackup();
    expect(record.status).toBe("succeeded");
    const orphan = (await meta.getJob(orphanId))!;
    expect(orphan).toMatchObject({ status: "failed", errorStage: "interrupted" });
    expect(orphan.errorMessage).toMatch(/yarıda kesildi/);
    expect(meta.auditLog.map((event) => event.action)).toContain("stale_lock_released");
    expect((await readdir(dir)).some((name) => name.endsWith(".partial"))).toBe(false);
  });

  it("G. taze kilit bayat sayılmaz (çalışan iş korunur)", async () => {
    meta.settings = { ...meta.settings, lockJobId: "eeeeeeee-0000-4000-8000-000000000001", lockOperation: "backup", lockHeartbeatAt: new Date(clock.getTime() - 60_000).toISOString() };
    await expect(engine.startManualBackup(OWNER)).rejects.toMatchObject({ code: "busy" });
  });

  it("H. 5 dk cooldown yalnız başarılı manuel yedekten sonra; başarısız yedek kilitlemez", async () => {
    db.failExport = new Error("db down");
    const failed = await engine.startManualBackup(OWNER);
    await expect(failed.completion).rejects.toBeInstanceOf(BackupError);
    db.failExport = null;
    const { record } = await manualBackup();
    expect(record.status).toBe("succeeded");

    clock = new Date(clock.getTime() + 2 * 60_000);
    const error = await engine.startManualBackup(OWNER).catch((caught: BackupError) => caught);
    expect(error).toMatchObject({ code: "cooldown", status: 429 });
    expect((error as BackupError).message).toBe("Yeni bir manuel yedek için 3 dakika bekleyin.");
    expect((error as BackupError).extra.retryAt).toBe("2026-10-14T11:35:00.000Z");
    expect((await engine.overview()).cooldownUntil).toBe("2026-10-14T11:35:00.000Z");

    clock = new Date("2026-10-14T11:35:00.000Z");
    expect((await manualBackup()).record.status).toBe("succeeded");
  });
});

describe("zamanlanmış yedek", () => {
  it("I. zamanı geldiyse (hiç yedek yok) cron yedeği alır: tür Otomatik, aktör cron", async () => {
    const result = await engine.runScheduled();
    expect(result.status).toBe("succeeded");
    const job = [...meta.jobs.values()][0];
    expect(job).toMatchObject({ kind: "scheduled", actor: "cron", actorUserId: null, status: "succeeded" });
    expect(meta.settings.cronLastSeenAt).toBe(clock.toISOString());
  });

  it("I. periyot dolunca tekrar; değişiklik yoksa yeni dosya yazılmaz (unchanged)", async () => {
    meta.settings.intervalMinutes = 60;
    expect((await engine.runScheduled()).status).toBe("succeeded");
    clock = new Date(clock.getTime() + 60 * 60_000);
    expect(await engine.runScheduled()).toEqual({ status: "unchanged" });
    expect(meta.jobs.size).toBe(1);
    expect(meta.settings.lastUnchangedAt).toBe(clock.toISOString());
    clock = new Date(clock.getTime() + 60 * 60_000);
    db.tables.workspace_posts[0].caption = "değişti";
    expect((await engine.runScheduled()).status).toBe("succeeded");
    expect(meta.jobs.size).toBe(2);
  });

  it("J. zamanı gelmediyse no-op (iş kaydı yok); kapalıysa disabled", async () => {
    meta.settings.intervalMinutes = 180;
    await manualBackup();
    clock = new Date(clock.getTime() + 60 * 60_000);
    const exportsBefore = db.exportCalls;
    expect(await engine.runScheduled()).toEqual({ status: "not_due", nextAt: "2026-10-14T14:30:00.000Z" });
    expect(db.exportCalls).toBe(exportsBefore);
    expect(meta.jobs.size).toBe(1);
    meta.settings.autoEnabled = false;
    clock = new Date(clock.getTime() + 24 * 60 * 60_000);
    expect(await engine.runScheduled()).toEqual({ status: "disabled" });
    expect(meta.jobs.size).toBe(1);
  });

  it("L. saklama: yalnız başarılı yeni yedekten sonra; son N tutulur, pre-restore korunur", async () => {
    meta.settings = { ...meta.settings, keepLast: 2, keepDailyDays: 0, keepWeeklyWeeks: 0, intervalMinutes: 15 };
    const ids: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      db.tables.workspace_posts[0].caption = `sürüm ${index}`;
      ids.push((await manualBackup()).record.id);
      clock = new Date(clock.getTime() + 6 * 60_000);
    }
    const oldest = (await meta.getJob(ids[0]))!;
    expect(oldest).toMatchObject({ deletedReason: "retention" });
    expect(await files.exists(oldest.fileName!)).toBe(false);
    expect((await meta.getJob(ids[1]))!.deletedAt).toBeNull();

    // Başarısız yedek saklama temizliği tetiklemez.
    db.failExport = new Error("x");
    await (await engine.startManualBackup(OWNER)).completion.catch(() => undefined);
    expect((await meta.getJob(ids[1]))!.deletedAt).toBeNull();
    db.failExport = null;

    // Geri yükleme öncesi yedek, sonraki normal yedeklerde silinmez.
    const restored = await restore(ids[2]);
    expect(restored.outcome.ok).toBe(true);
    const safetyId = restored.record.safetyBackupId!;
    for (let index = 0; index < 3; index += 1) {
      clock = new Date(clock.getTime() + 6 * 60_000);
      db.tables.workspace_posts[0].caption = `sonra ${index}`;
      await manualBackup();
    }
    expect((await meta.getJob(safetyId))!.deletedAt).toBeNull();
  });

  it("AC. başarı sonrası meta veri doğru; denetim kaydı yazılır", async () => {
    clock = new Date("2026-10-14T11:30:00.000Z");
    const { record } = await manualBackup();
    const size = (await readFile(files.filePath(record.fileName!))).length;
    expect(record).toMatchObject({ status: "succeeded", sizeBytes: size, dbRowCount: 13, mediaFileCount: 5, finishedAt: "2026-10-14T11:30:00.000Z", errorStage: null });
    expect(record.summary.tables).toMatchObject({ workspace_posts: 2, share_snapshots: 2, instagram_import_jobs: 1 });
    expect(toJobView(record)).toMatchObject({ restorable: true, durationMs: 0, progress: null });
    expect(meta.auditLog.map((event) => event.action)).toEqual(["backup_started", "backup_succeeded"]);
    const overview = await engine.overview();
    expect(overview).toMatchObject({ lastSuccessAt: "2026-10-14T11:30:00.000Z", nextAutoAt: "2026-10-15T11:30:00.000Z", totalBytes: size, running: null });
  });

  it("AD. başarısız yedek 'başarılı' görünmez: dosya yok, geri yüklenemez, hata aşaması kayıtlı", async () => {
    storage.failDownload = (_bucket, file) => file.endsWith("b.jpg");
    const { job, completion } = await engine.startManualBackup(OWNER);
    const error = await completion.catch((caught: BackupError) => caught);
    expect(error).toBeInstanceOf(BackupError);
    const record = (await meta.getJob(job.id))!;
    expect(record).toMatchObject({ status: "failed", errorStage: "download_media", fileName: null, sizeBytes: null });
    expect(record.errorMessage).toMatch(/^Yedekleme başarısız: Medya dosyası indirilemedi/);
    expect(toJobView(record).restorable).toBe(false);
    expect(await readdir(dir)).toEqual([]);
    await expect(engine.startRestore(job.id, OWNER)).rejects.toMatchObject({ code: "not_restorable", status: 409 });
    expect(meta.auditLog.map((event) => event.action)).toContain("backup_failed");
    expect(meta.settings.lockJobId).toBeNull();
  });
});

describe("doğrulama ve bozuk yedekler", () => {
  it("geçerli yedek doğrulanır", async () => {
    const { record } = await manualBackup();
    expect(await engine.validateBackup(record.id)).toEqual({ ok: true, errors: [], warnings: [] });
  });

  it("M. bozuk ZIP geri yüklenmez; güvenlik yedeği bile alınmaz, veri değişmez", async () => {
    const { record } = await manualBackup();
    await writeFile(files.filePath(record.fileName!), "bu bir zip değil");
    mutateWorkspace();
    const before = JSON.stringify(db.tables);
    const { outcome, record: job } = await restore(record.id);
    expect(outcome.ok).toBe(false);
    expect(job).toMatchObject({ status: "failed", errorStage: "validate" });
    expect(job.errorMessage).toMatch(/ZIP dosyası okunamadı veya bozuk/);
    expect(JSON.stringify(db.tables)).toBe(before);
    expect([...meta.jobs.values()].some((item) => item.kind === "pre_restore")).toBe(false);
  });

  it("N. yanlış sağlama toplamı reddedilir (CRC geçerli ama içerik değiştirilmiş)", async () => {
    const { record } = await manualBackup();
    await rewritePackage(record.fileName!, (name, data) => (name === "database/workspace_posts.json" ? Buffer.from(data.toString().replace("İlk gönderi", "Kurcalandı!")) : data));
    const result = await engine.validateBackup(record.id);
    expect(result).toEqual({ ok: false, errors: ["Sağlama toplamı tutmuyor: database/workspace_posts.json"], warnings: [] });
    expect((await restore(record.id)).record.errorStage).toBe("validate");
  });

  it("O. manifest.json eksikse reddedilir", async () => {
    const { record } = await manualBackup();
    await rewritePackage(record.fileName!, (name, data) => (name === MANIFEST_ENTRY ? null : data));
    expect((await engine.validateBackup(record.id)).errors).toEqual(["Yedekte manifest.json bulunamadı."]);
  });

  it("desteklenmeyen sürüm, eksik tablo ve pakete sızdırılmış dosya reddedilir", async () => {
    const { record } = await manualBackup();
    const edit = (change: (manifest: Record<string, unknown>) => void) => (name: string, data: Buffer) => {
      if (name !== MANIFEST_ENTRY) return data;
      const manifest = JSON.parse(data.toString());
      change(manifest);
      return Buffer.from(JSON.stringify(manifest));
    };
    await rewritePackage(record.fileName!, edit((manifest) => { manifest.formatVersion = 2; }));
    expect((await engine.validateBackup(record.id)).errors[0]).toMatch(/daha yeni bir uygulama sürümüyle/);
    await rewritePackage(record.fileName!, edit((manifest) => { manifest.formatVersion = 1; manifest.schemaVersion = "20991231000000"; }));
    expect((await engine.validateBackup(record.id)).errors[0]).toMatch(/daha yeni bir veritabanı şemasıyla/);
    await rewritePackage(record.fileName!, edit((manifest) => {
      manifest.schemaVersion = "20261014160000";
      manifest.tables = (manifest.tables as Array<{ name: string }>).filter((table) => table.name !== "share_feedback");
    }));
    expect((await engine.validateBackup(record.id)).errors[0]).toBe("Yedekte beklenen tablo yok: share_feedback");
  });

  it("pakete eklenmiş tanımsız dosya (.env) reddedilir", async () => {
    const { record } = await manualBackup();
    await rewritePackage(record.fileName!, (_name, data) => data, [[".env", "SUPABASE_SECRET_KEY=x"]]);
    expect((await engine.validateBackup(record.id)).errors).toEqual(["Pakette manifest'te olmayan dosya var: .env"]);
  });
});

describe("geri yükleme", () => {
  it("P/R/S. güvenlik yedeği alınır; DB ve medya seçilen yedeğe döner", async () => {
    const { record: source } = await manualBackup();
    clock = new Date("2026-10-14T13:00:00.000Z");
    mutateWorkspace();
    const { job, outcome, record } = await restore(source.id);
    expect(job).toMatchObject({ kind: "restore", status: "running", sourceBackupId: source.id });
    expect(outcome.ok).toBe(true);
    expect(record).toMatchObject({ status: "succeeded", sourceBackupId: source.id, errorStage: null });

    // P: güvenlik yedeği önce alındı ve mevcut (değişmiş) durumu içeriyor.
    const safety = (await meta.getJob(record.safetyBackupId!))!;
    expect(safety).toMatchObject({ kind: "pre_restore", status: "succeeded" });
    const safetyPkg = await readPackage(safety.fileName!);
    const safetyBrands = JSON.parse((await safetyPkg.read("database/workspace_brands.json")).toString());
    expect(safetyBrands.map((brand: TableRow) => brand.id)).toEqual(["b1", "b2"]);
    expect(safetyPkg.entries).toContain(`storage/workspace-media/${OWNER}/new.jpg`);
    await safetyPkg.reader.close();

    // R: veritabanı yedekteki haline döndü.
    for (const table of RESTORE_TABLES) expect(db.tables[table]).toEqual(fixtureTables()[table]);
    // S: silinen medya geri geldi, yedekte olmayan yeni medya temizlendi.
    expect((await storage.download("workspace-media", `${OWNER}/b.jpg`)).data.toString()).toBe("jpeg-b-bytes");
    expect(storage.buckets.get("workspace-media")!.has(`${OWNER}/new.jpg`)).toBe(false);
    expect(record.summary).toMatchObject({ mediaUploaded: 1, mediaRemoved: 1, restoredCounts: { workspace_posts: 2 } });
    expect(toJobView(record).restoreEpoch).toBe(db.epoch);
    expect(meta.auditLog.map((event) => event.action)).toEqual(expect.arrayContaining(["restore_started", "restore_succeeded"]));
    expect(meta.settings.lockJobId).toBeNull();
  });

  it("Q. güvenlik yedeği başarısızsa geri yükleme BAŞLAMAZ; hiçbir veri/medya değişmez", async () => {
    const { record: source } = await manualBackup();
    mutateWorkspace();
    const before = JSON.stringify(db.tables);
    storage.failDownload = () => true;
    const { outcome, record } = await restore(source.id);
    expect(outcome.ok).toBe(false);
    expect(record).toMatchObject({ status: "failed", errorStage: "safety_backup" });
    expect(record.errorMessage).toBe("Geri yükleme öncesi güvenlik yedeği alınamadı; geri yükleme başlatılmadı. Mevcut veriler değiştirilmedi.");
    expect(JSON.stringify(db.tables)).toBe(before);
    expect(storage.buckets.get("workspace-media")!.has(`${OWNER}/b.jpg`)).toBe(false);
    expect(db.staging.size).toBe(0);
    expect((await meta.getJob(record.safetyBackupId!))!.status).toBe("failed");
  });

  it("T. DB transaction başarısızsa: eklenen medya geri alınır, staging temizlenir, veri değişmez", async () => {
    const { record: source } = await manualBackup();
    mutateWorkspace();
    const before = JSON.stringify(db.tables);
    db.failApply = new Error('insert or update on table "workspace_posts" violates foreign key constraint');
    const { outcome, record } = await restore(source.id);
    expect(outcome.ok).toBe(false);
    expect(record).toMatchObject({ status: "failed", errorStage: "db_apply" });
    expect(record.errorMessage).toBe("Veritabanı geri yüklenemedi; tüm değişiklikler geri alındı. Mevcut veriler değiştirilmedi.");
    expect(record.errorMessage).not.toMatch(/foreign key/);
    expect(JSON.stringify(db.tables)).toBe(before);
    expect(storage.buckets.get("workspace-media")!.has(`${OWNER}/b.jpg`)).toBe(false);
    expect(storage.buckets.get("workspace-media")!.has(`${OWNER}/new.jpg`)).toBe(true);
    expect(db.staging.size).toBe(0);
    expect(toJobView(record).restoreEpoch).toBeNull();
    expect(logs.find((log) => log.event === "restore_failed")?.details).toMatchObject({ stage: "db_apply" });
  });

  it("T. medya yüklemesi yarıda kalırsa önceden yüklenenler silinir; DB'ye hiç gidilmez", async () => {
    const { record: source } = await manualBackup();
    storage.buckets.get("workspace-media")!.clear();
    storage.failUpload = (_bucket, file) => file.endsWith("s.jpg");
    const { record } = await restore(source.id);
    expect(record).toMatchObject({ status: "failed", errorStage: "media_staging" });
    expect(storage.buckets.get("workspace-media")!.size).toBe(0);
    expect(db.epoch).toBeNull();
  });

  it("T. aynı yolda farklı medya varsa (çakışma) geri yükleme yapılmaz", async () => {
    const { record: source } = await manualBackup();
    storage.put("workspace-media", `${OWNER}/a.jpg`, "başka içerik, farklı boyut");
    const { record } = await restore(source.id);
    expect(record).toMatchObject({ status: "failed", errorStage: "media_staging" });
    expect(record.errorMessage).toMatch(/Medya çakışması/);
    expect(db.epoch).toBeNull();
  });

  it("T. RPC yanıtı kaybolsa da işlenen transaction tanınır (yanlış 'başarısız' yok)", async () => {
    const { record: source } = await manualBackup();
    mutateWorkspace();
    db.loseApplyResponse = true;
    db.onApply = async (jobId, epoch, counts) => {
      const job = (await meta.getJob(jobId))!;
      await meta.updateJob(jobId, { summary: { ...job.summary, dbCommittedAt: clock.toISOString(), epoch, restoredCounts: counts } });
    };
    const { outcome, record } = await restore(source.id);
    expect(outcome.ok).toBe(true);
    expect(record.status).toBe("succeeded");
    expect(toJobView(record).restoreEpoch).toBe(db.epoch);
  });

  it("medya temizliği başarısızsa geri yükleme başarılı ama uyarılı (kritik aşama değil)", async () => {
    const { record: source } = await manualBackup();
    mutateWorkspace();
    const original = storage.remove.bind(storage);
    let calls = 0;
    storage.remove = async (bucket, paths) => {
      calls += 1;
      throw Object.assign(new Error("remove failed"), { bucket, paths, calls });
    };
    const { record } = await restore(source.id);
    storage.remove = original;
    expect(record.status).toBe("succeeded");
    expect(record.summary.warnings).toEqual(["Geri yüklenen yedekte olmayan bazı eski medya dosyaları silinemedi; çalışma alanı verileri etkilenmez."]);
    for (const table of RESTORE_TABLES) expect(db.tables[table]).toEqual(fixtureTables()[table]);
  });

  it("U. Auth kullanıcıları geri yüklenmez: yedekteki kullanıcı yoksa reddedilir; farklı sahip reddedilir", async () => {
    const { record: source } = await manualBackup();
    const pkg = await readPackage(source.fileName!);
    expect(pkg.entries.some((name) => name.includes("auth"))).toBe(false);
    await pkg.reader.close();

    db.authUsers.delete(OWNER);
    let result = await restore(source.id);
    expect(result.record).toMatchObject({ status: "failed", errorStage: "validate" });
    expect(result.record.errorMessage).toMatch(/kullanıcı hesabı bu projede bulunmuyor/);
    db.authUsers.add(OWNER);

    db.tables.workspace_bootstrap = [{ id: true, owner_id: STRANGER }];
    db.authUsers.add(STRANGER);
    result = await restore(source.id);
    expect(result.record.errorMessage).toBe("Bu yedek farklı bir çalışma alanı sahibine ait; geri yükleme yapılmadı.");
    expect(db.tables.workspace_bootstrap).toEqual([{ id: true, owner_id: STRANGER }]);
  });

  it("V. süresi dolmuş paylaşım süresi dolmuş kalır (expires_at aynen)", async () => {
    const { record: source } = await manualBackup();
    db.tables.share_snapshots = [];
    await restore(source.id);
    const expired = db.tables.share_snapshots.find((share) => share.token === T_EXPIRED)!;
    expect(expired.expires_at).toBe("2026-10-01T00:00:00.000Z");
    expect(Date.parse(String(expired.expires_at))).toBeLessThan(clock.getTime());
    expect(db.tables.share_snapshots.find((share) => share.token === T_ACTIVE)!.expires_at).toBe("2026-11-09T00:00:00.000Z");
  });

  it("W. Instagram içe aktarma işleri ve workspace_bootstrap geri yüklenmez (mevcut satırlar korunur)", async () => {
    const { record: source } = await manualBackup();
    db.tables.instagram_import_jobs = [{ id: "a0a0a0a0-0000-4000-8000-000000000009", user_id: OWNER, username: "yeni", snapshot_id: "snap-9", status: "preparing" }];
    const current = JSON.stringify(db.tables.instagram_import_jobs);
    await restore(source.id);
    expect(JSON.stringify(db.tables.instagram_import_jobs)).toBe(current);
    expect(db.tables.workspace_bootstrap).toEqual(fixtureTables().workspace_bootstrap);
  });

  it("geri yükleme sürerken ikinci işlem ve kaynak yedeğin silinmesi engellenir", async () => {
    const { record: source } = await manualBackup();
    clock = new Date(clock.getTime() + 6 * 60_000);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const originalList = storage.list.bind(storage);
    let blocked = false;
    storage.list = async (bucket) => {
      if (!blocked && meta.settings.lockOperation === "restore" && [...meta.jobs.values()].some((job) => job.kind === "pre_restore" && job.status === "succeeded")) {
        blocked = true;
        await gate;
      }
      return originalList(bucket);
    };
    const { completion } = await engine.startRestore(source.id, OWNER);
    await new Promise((resolve) => setTimeout(resolve, 50));
    await expect(engine.deleteBackup(source.id, OWNER)).rejects.toMatchObject({ code: "in_use", status: 409 });
    await expect(engine.startManualBackup(OWNER)).rejects.toMatchObject({ code: "busy" });
    release();
    await completion;
    await engine.deleteBackup(source.id, OWNER);
    expect((await meta.getJob(source.id))!).toMatchObject({ deletedReason: "user", deletedBy: OWNER });
  });
});

describe("silme ve indirme", () => {
  it("silme: dosya kaldırılır, kayıt işaretlenir, denetime yazılır; çalışan yedek silinemez", async () => {
    const { record } = await manualBackup();
    await engine.deleteBackup(record.id, OWNER);
    expect(await files.exists(record.fileName!)).toBe(false);
    expect((await meta.getJob(record.id))!.deletedReason).toBe("user");
    expect(meta.auditLog.at(-1)).toMatchObject({ action: "backup_deleted", actorUserId: OWNER, jobId: record.id });
    await expect(engine.deleteBackup(record.id, OWNER)).rejects.toMatchObject({ code: "not_found" });

    clock = new Date(clock.getTime() + 6 * 60_000);
    const running = await engine.startManualBackup(OWNER);
    await expect(engine.deleteBackup(running.job.id, OWNER)).rejects.toMatchObject({ code: "in_use" });
    await running.completion;
  });

  it("Z. kimlik yerine yol gönderilemez (path traversal reddedilir)", async () => {
    for (const id of ["../../etc/passwd", "backup-2026-10-14-113000-aaaaaaaa.zip", "..%2F..%2Fsecret"]) {
      await expect(engine.deleteBackup(id, OWNER)).rejects.toMatchObject({ code: "not_found" });
      await expect(engine.openDownload(id, OWNER)).rejects.toMatchObject({ code: "not_found" });
      await expect(engine.startRestore(id, OWNER)).rejects.toMatchObject({ code: "not_found" });
    }
  });

  it("indirme: dosya akışı + denetim kaydı", async () => {
    const { record } = await manualBackup();
    const { stream, size, fileName } = await engine.openDownload(record.id, OWNER);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    expect(Buffer.concat(chunks).equals(await readFile(files.filePath(record.fileName!)))).toBe(true);
    expect(size).toBe(record.sizeBytes);
    expect(fileName).toBe(record.fileName);
    expect(meta.auditLog.at(-1)).toMatchObject({ action: "backup_downloaded" });
  });

  it("BACKUP_DIR geçersizse yedek/geri yükleme 503; genel görünüm hatayı gösterir", async () => {
    engine = makeEngine({ files: null, storageError: "Yedek dizini yapılandırılmamış (BACKUP_DIR). Yedekleme devre dışı." });
    await expect(engine.startManualBackup(OWNER)).rejects.toMatchObject({ code: "storage_unavailable", status: 503 });
    expect((await engine.overview()).storage).toEqual({ ok: false, error: "Yedek dizini yapılandırılmamış (BACKUP_DIR). Yedekleme devre dışı." });
  });
});
