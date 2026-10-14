import { mkdtemp, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FileSystemBackupStore, backupFileName, isBackupFileName, resolveBackupDir } from "./files";

const APP = path.resolve(tmpdir(), "home", "user", "public_html", "grid");
const env = (values: Record<string, string>) => values as unknown as NodeJS.ProcessEnv;

describe("BACKUP_DIR çözümü", () => {
  const outside = path.resolve(tmpdir(), "home", "user", "grid-backups");

  it("development'ta tanımsızsa proje içi .backups (gitignore)", () => {
    expect(resolveBackupDir(env({ NODE_ENV: "development" }), "/proj")).toEqual({ ok: true, dir: path.join(path.resolve("/proj"), ".backups"), fallback: true });
  });

  it("production'da tanımsızsa HATA (sessizce açık dizine yazılmaz)", () => {
    expect(resolveBackupDir(env({ NODE_ENV: "production" }), APP)).toEqual({ ok: false, error: "Yedek dizini yapılandırılmamış (BACKUP_DIR). Yedekleme devre dışı." });
  });

  it("public_html dışındaki mutlak dizin kabul edilir", () => {
    expect(resolveBackupDir(env({ NODE_ENV: "production", BACKUP_DIR: outside }), APP)).toEqual({ ok: true, dir: outside, fallback: false });
  });

  it("göreli yol, public_html, uygulama klasörü ve public/ reddedilir", () => {
    expect(resolveBackupDir(env({ NODE_ENV: "production", BACKUP_DIR: "grid-backups" }), APP)).toMatchObject({ ok: false, error: "BACKUP_DIR mutlak bir yol olmalı." });
    expect(resolveBackupDir(env({ NODE_ENV: "production", BACKUP_DIR: path.resolve(tmpdir(), "home", "user", "public_html", "backups") }), APP)).toMatchObject({ ok: false });
    expect(resolveBackupDir(env({ NODE_ENV: "production", BACKUP_DIR: path.resolve(tmpdir(), "home", "user", "Public_HTML", "x") }), APP)).toMatchObject({ ok: false });
    expect(resolveBackupDir(env({ NODE_ENV: "development", BACKUP_DIR: path.join("/proj", "public", "b") }), "/proj")).toMatchObject({ ok: false });
    expect(resolveBackupDir(env({ NODE_ENV: "production", BACKUP_DIR: path.join("/srv/app", "data") }), "/srv/app")).toMatchObject({ ok: false, error: "BACKUP_DIR production'da uygulama klasörünün dışında olmalı." });
    expect(resolveBackupDir(env({ NODE_ENV: "production", BACKUP_DIR: path.resolve(tmpdir(), "home", "user", "x", "..", "public_html") }), APP)).toMatchObject({ ok: false });
  });
});

describe("Z. dosya deposu path traversal güvenliği", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "dijivo-files-test-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("dosya adı yalnız sunucu biçiminde; yol her zaman dizinin içinde", () => {
    const name = backupFileName(new Date("2026-10-14T14:30:05.000Z"), "1a2b3c4d-0000-4000-8000-000000000000");
    expect(name).toBe("backup-2026-10-14-143005-1a2b3c4d.zip");
    const store = new FileSystemBackupStore(dir);
    expect(path.dirname(store.filePath(name))).toBe(path.resolve(dir));
    for (const bad of ["../backup-2026-10-14-143005-1a2b3c4d.zip", "..\\x.zip", "/etc/passwd", "backup-2026-10-14-143005-1a2b3c4d.zip/../../x", ".env", "backup-2026-10-14-143005-ZZZZZZZZ.zip"]) {
      expect(isBackupFileName(bad)).toBe(false);
      expect(() => store.filePath(bad)).toThrow(/Geçersiz yedek dosyası/);
    }
  });

  it("finalize üzerine yazmaz; remove yalnız geçerli adla; eski .partial temizlenir", async () => {
    const store = new FileSystemBackupStore(dir);
    const name = "backup-2026-10-14-143005-1a2b3c4d.zip";
    await writeFile(store.partialPath(name), "x");
    expect(await store.finalize(name)).toBe(1);
    await writeFile(store.partialPath(name), "y");
    await expect(store.finalize(name)).rejects.toThrow(/zaten var/);
    await expect(store.remove("../secret")).rejects.toThrow(/Geçersiz/);

    const old = new Date("2026-01-01T00:00:00.000Z");
    await utimes(store.partialPath(name), old, old);
    await writeFile(path.join(dir, "notes.txt.partial"), "başka dosya");
    expect(await store.cleanupPartials(new Date("2026-10-01T00:00:00.000Z"))).toBe(1);
    expect((await readdir(dir)).sort()).toEqual([name, "notes.txt.partial"].sort());
  });
});
