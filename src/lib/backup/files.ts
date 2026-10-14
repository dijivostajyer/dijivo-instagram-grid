import { createReadStream, type ReadStream } from "node:fs";
import { mkdir, readdir, rename, stat, unlink } from "node:fs/promises";
import path from "node:path";

/** Sunucunun ürettiği tek yedek dosyası adı biçimi (UTC zaman + kimlik öneki). */
export const BACKUP_FILE_NAME_RE = /^backup-\d{4}-\d{2}-\d{2}-\d{6}-[0-9a-f]{8}\.zip$/;
const PARTIAL_SUFFIX = ".partial";

export function isBackupFileName(name: unknown): name is string {
  return typeof name === "string" && BACKUP_FILE_NAME_RE.test(name);
}

/** `backup-2026-10-14-143000-1a2b3c4d.zip` (zaman UTC). */
export function backupFileName(startedAt: Date, jobId: string): string {
  const pad = (value: number, length = 2) => String(value).padStart(length, "0");
  const date = `${startedAt.getUTCFullYear()}-${pad(startedAt.getUTCMonth() + 1)}-${pad(startedAt.getUTCDate())}`;
  const time = `${pad(startedAt.getUTCHours())}${pad(startedAt.getUTCMinutes())}${pad(startedAt.getUTCSeconds())}`;
  return `backup-${date}-${time}-${jobId.replace(/-/g, "").slice(0, 8).toLowerCase()}.zip`;
}

export type BackupDirResult = { ok: true; dir: string; fallback: boolean } | { ok: false; error: string };

function isInside(child: string, parent: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/**
 * Yedek dizinini çözer. Kullanıcı girdisi DEĞİL, yalnız sunucu ortamıdır.
 *
 * - BACKUP_DIR mutlak yol olmalı; `public_html` altında veya uygulama
 *   kökünün `public/` klasöründe olamaz (web'den erişilebilir olurdu).
 * - Production'da uygulama kökünün içinde de olamaz (cPanel'de uygulama
 *   kökü public_html/grid altındadır).
 * - Tanımlı değilse: development'ta `<proje>/.backups` (gitignore'da),
 *   production'da HATA (sessizce açık bir dizine yazılmaz).
 */
export function resolveBackupDir(env: NodeJS.ProcessEnv, cwd: string): BackupDirResult {
  const production = env.NODE_ENV === "production";
  const raw = env.BACKUP_DIR?.trim();
  const appRoot = path.resolve(cwd);
  if (!raw) {
    if (production) return { ok: false, error: "Yedek dizini yapılandırılmamış (BACKUP_DIR). Yedekleme devre dışı." };
    return { ok: true, dir: path.join(appRoot, ".backups"), fallback: true };
  }
  if (!path.isAbsolute(raw)) return { ok: false, error: "BACKUP_DIR mutlak bir yol olmalı." };
  const dir = path.resolve(raw);
  if (dir.split(/[\\/]+/).some((part) => part.toLowerCase() === "public_html")) {
    return { ok: false, error: "BACKUP_DIR public_html altında olamaz; yedekler web'den erişilebilir olurdu." };
  }
  if (isInside(dir, path.join(appRoot, "public"))) return { ok: false, error: "BACKUP_DIR uygulamanın public klasöründe olamaz." };
  if (production && isInside(dir, appRoot)) return { ok: false, error: "BACKUP_DIR production'da uygulama klasörünün dışında olmalı." };
  if (path.parse(dir).root === dir) return { ok: false, error: "BACKUP_DIR kök dizin olamaz." };
  return { ok: true, dir, fallback: false };
}

export interface BackupFileStore {
  ensureDir(): Promise<void>;
  partialPath(name: string): string;
  finalize(name: string): Promise<number>;
  exists(name: string): Promise<boolean>;
  size(name: string): Promise<number | null>;
  remove(name: string): Promise<void>;
  removePartial(name: string): Promise<void>;
  /** Yarım kalmış (.partial) ve belirtilen süreden eski dosyaları siler. */
  cleanupPartials(olderThan: Date): Promise<number>;
  filePath(name: string): string;
  openRead(name: string): Promise<{ stream: ReadStream; size: number }>;
}

/**
 * Yerel dosya sistemi deposu. Tüm yollar `dir` + doğrulanmış dosya adından
 * üretilir; ad biçim dışıysa veya çözülen yol dizinden çıkıyorsa hata verir.
 */
export class FileSystemBackupStore implements BackupFileStore {
  readonly dir: string;

  constructor(dir: string) {
    this.dir = path.resolve(dir);
  }

  private resolve(name: string, suffix = ""): string {
    if (!isBackupFileName(name)) throw new Error("Geçersiz yedek dosyası adı.");
    const resolved = path.resolve(this.dir, name + suffix);
    if (path.dirname(resolved) !== this.dir) throw new Error("Geçersiz yedek dosyası yolu.");
    return resolved;
  }

  async ensureDir(): Promise<void> {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
  }

  filePath(name: string): string {
    return this.resolve(name);
  }

  partialPath(name: string): string {
    return this.resolve(name, PARTIAL_SUFFIX);
  }

  async finalize(name: string): Promise<number> {
    const target = this.resolve(name);
    if (await this.exists(name)) throw new Error("Aynı adlı yedek dosyası zaten var.");
    await rename(this.partialPath(name), target);
    return (await stat(target)).size;
  }

  async exists(name: string): Promise<boolean> {
    return (await this.size(name)) !== null;
  }

  async size(name: string): Promise<number | null> {
    try {
      const info = await stat(this.resolve(name));
      return info.isFile() ? info.size : null;
    } catch {
      return null;
    }
  }

  async remove(name: string): Promise<void> {
    await unlink(this.resolve(name)).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }

  async removePartial(name: string): Promise<void> {
    await unlink(this.partialPath(name)).catch(() => undefined);
  }

  async cleanupPartials(olderThan: Date): Promise<number> {
    let removed = 0;
    let names: string[];
    try {
      names = await readdir(this.dir);
    } catch {
      return 0;
    }
    for (const name of names) {
      if (!name.endsWith(PARTIAL_SUFFIX) || !isBackupFileName(name.slice(0, -PARTIAL_SUFFIX.length))) continue;
      const full = path.join(this.dir, name);
      try {
        if ((await stat(full)).mtime < olderThan) {
          await unlink(full);
          removed += 1;
        }
      } catch {
        // başka bir işlem silmiş olabilir
      }
    }
    return removed;
  }

  async openRead(name: string): Promise<{ stream: ReadStream; size: number }> {
    const full = this.resolve(name);
    const info = await stat(full);
    if (!info.isFile()) throw new Error("Yedek dosyası bulunamadı.");
    return { stream: createReadStream(full), size: info.size };
  }
}
