import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ZipFormatError, ZipReader, ZipWriter, crc32, isSafeZipName } from "./zip";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "dijivo-zip-test-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function writeSample(file: string, options: { forceZip64?: boolean } = {}) {
  const writer = await ZipWriter.create(file, options);
  await writer.add("database/a.json", Buffer.from(JSON.stringify([{ ad: "Ayşe", not: "ğüşiöç" }])), { compress: true });
  await writer.add("storage/workspace-media/u/x.jpg", Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01]));
  await writer.add("manifest.json", Buffer.from("{}".repeat(500)), { compress: true });
  return writer.close();
}

describe("ZIP yazıcı/okuyucu", () => {
  it("CRC32 bilinen değer", () => {
    expect(crc32(Buffer.from("123456789"))).toBe(0xcbf43926);
  });

  it("deflate + store gidiş-dönüş; UTF-8 adlar ve içerik korunur", async () => {
    const file = path.join(dir, "a.zip");
    const { entries } = await writeSample(file);
    expect(entries).toBe(3);
    const reader = await ZipReader.open(file);
    expect(reader.entries().map((entry) => entry.name)).toEqual(["database/a.json", "storage/workspace-media/u/x.jpg", "manifest.json"]);
    expect(JSON.parse((await reader.read("database/a.json")).toString("utf8"))).toEqual([{ ad: "Ayşe", not: "ğüşiöç" }]);
    expect([...(await reader.read("storage/workspace-media/u/x.jpg"))]).toEqual([0xff, 0xd8, 0xff, 0x00, 0x01]);
    expect(reader.entries().find((entry) => entry.name === "manifest.json")!.method).toBe(8);
    await reader.close();
  });

  it("ZIP64 kayıtlarıyla yazılan paket okunur (4 GB üstü düzen)", async () => {
    const file = path.join(dir, "z64.zip");
    await writeSample(file, { forceZip64: true });
    const bytes = await readFile(file);
    expect(bytes.includes(Buffer.from([0x50, 0x4b, 0x06, 0x06]))).toBe(true);
    const reader = await ZipReader.open(file);
    expect(reader.entries()).toHaveLength(3);
    expect((await reader.read("manifest.json")).toString()).toBe("{}".repeat(500));
    await reader.close();
  });

  it("M. ZIP olmayan / kesilmiş dosya reddedilir", async () => {
    const garbage = path.join(dir, "garbage.zip");
    await writeFile(garbage, "merhaba dünya");
    await expect(ZipReader.open(garbage)).rejects.toBeInstanceOf(ZipFormatError);
    const file = path.join(dir, "cut.zip");
    await writeSample(file);
    const bytes = await readFile(file);
    await writeFile(file, bytes.subarray(0, bytes.length - 30));
    await expect(ZipReader.open(file)).rejects.toBeInstanceOf(ZipFormatError);
  });

  it("N. içerik baytı bozulursa CRC hatası", async () => {
    const file = path.join(dir, "crc.zip");
    await writeSample(file);
    const bytes = await readFile(file);
    const at = bytes.indexOf(Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01]));
    bytes[at + 4] = 0x02;
    await writeFile(file, bytes);
    const reader = await ZipReader.open(file);
    await expect(reader.read("storage/workspace-media/u/x.jpg")).rejects.toThrow(/CRC/);
    await reader.close();
  });

  it("Z. güvensiz adlar yazılmaz ve okunmaz (../, mutlak, sürücü, ters eğik çizgi)", async () => {
    for (const name of ["../x", "a/../../x", "/etc/passwd", "C:/x", "a\\b", "a//b", "./a", ""]) expect(isSafeZipName(name)).toBe(false);
    expect(isSafeZipName("storage/workspace-media/u/x.jpg")).toBe(true);
    const writer = await ZipWriter.create(path.join(dir, "w.zip"));
    await expect(writer.add("../evil", Buffer.from("x"))).rejects.toBeInstanceOf(ZipFormatError);
    await writer.close();

    // Geçerli bir paketteki adı "../" içerecek şekilde elle değiştir.
    const file = path.join(dir, "evil.zip");
    const evil = await ZipWriter.create(file);
    await evil.add("aaa/x", Buffer.from("x"));
    await evil.close();
    const bytes = await readFile(file);
    let at = bytes.indexOf(Buffer.from("aaa/x"));
    while (at !== -1) {
      bytes.write("../xx", at, "utf8");
      at = bytes.indexOf(Buffer.from("aaa/x"), at + 1);
    }
    await writeFile(file, bytes);
    await expect(ZipReader.open(file)).rejects.toThrow(/Güvensiz paket adı/);
  });

  it("tekrarlanan ad yazılmaz; mevcut dosyanın üzerine yazılmaz", async () => {
    const file = path.join(dir, "dup.zip");
    const writer = await ZipWriter.create(file);
    await writer.add("a", Buffer.from("1"));
    await expect(writer.add("a", Buffer.from("2"))).rejects.toThrow(/Tekrarlanan/);
    await writer.close();
    await expect(ZipWriter.create(file)).rejects.toThrow();
  });
});
