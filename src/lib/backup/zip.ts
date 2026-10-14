import { open, unlink, type FileHandle } from "node:fs/promises";
import { deflateRawSync, inflateRawSync } from "node:zlib";

import { isSafeArchivePath } from "./manifest";

/**
 * Bağımlılıksız, en küçük ZIP yazıcı/okuyucu (yedek paketleri için).
 *
 * - Yöntemler: 0 (store; zaten sıkıştırılmış medya) ve 8 (deflate; JSON).
 * - ZIP64: 4 GB'ı aşan ofset/boyutlarda ve 65.535+ girdide otomatik
 *   kullanılır (Reel videolarıyla büyüyen paketler bozulmadan yazılır).
 * - Okuyucu her girdide CRC32 ve boyutu doğrular; dosya sınırı dışına
 *   taşan ofsetleri, tekrarlanan ve güvensiz (`..`, mutlak) adları reddeder.
 */
export class ZipFormatError extends Error {}

const U16 = 0xffff;
const U32 = 0xffffffff;
const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;
const SIG_ZIP64_EOCD = 0x06064b50;
const SIG_ZIP64_LOCATOR = 0x07064b50;
const UTF8_FLAG = 0x0800;
const ZIP64_EXTRA = 0x0001;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.min(2107, Math.max(1980, date.getUTCFullYear()));
  return {
    time: (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | Math.floor(date.getUTCSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate(),
  };
}

export const isSafeZipName = isSafeArchivePath;

interface CentralRecord {
  name: Buffer;
  method: number;
  crc: number;
  compressedSize: number;
  size: number;
  offset: number;
  time: number;
  date: number;
}

function u64(value: number): Buffer {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(BigInt(value));
  return buffer;
}

export class ZipWriter {
  private offset = 0;
  private readonly records: CentralRecord[] = [];
  private readonly names = new Set<string>();

  private constructor(private readonly handle: FileHandle, readonly path: string, private readonly forceZip64: boolean) {}

  /** Yeni dosya oluşturur (varsa hata: üzerine yazmaz), izin 0600. */
  static async create(path: string, options: { forceZip64?: boolean } = {}): Promise<ZipWriter> {
    return new ZipWriter(await open(path, "wx", 0o600), path, Boolean(options.forceZip64));
  }

  get entryCount(): number {
    return this.records.length;
  }

  private async write(buffer: Uint8Array) {
    await this.handle.write(buffer, 0, buffer.length, this.offset);
    this.offset += buffer.length;
  }

  async add(name: string, data: Uint8Array, options: { compress?: boolean; date?: Date } = {}): Promise<void> {
    if (!isSafeZipName(name)) throw new ZipFormatError(`Güvensiz paket adı: ${name}`);
    if (this.names.has(name)) throw new ZipFormatError(`Tekrarlanan paket adı: ${name}`);
    const compressed = options.compress ? deflateRawSync(data) : null;
    const useDeflate = Boolean(compressed && compressed.length < data.length);
    const body = useDeflate && compressed ? compressed : data;
    const nameBytes = Buffer.from(name, "utf8");
    const { time, date } = dosDateTime(options.date ?? new Date());
    const crc = crc32(data);
    const zip64 = this.forceZip64 || data.length >= U32 || body.length >= U32;
    const extra = zip64 ? Buffer.concat([Buffer.from([ZIP64_EXTRA & 0xff, ZIP64_EXTRA >> 8, 16, 0]), u64(data.length), u64(body.length)]) : Buffer.alloc(0);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(SIG_LOCAL, 0);
    header.writeUInt16LE(zip64 ? 45 : 20, 4);
    header.writeUInt16LE(UTF8_FLAG, 6);
    header.writeUInt16LE(useDeflate ? 8 : 0, 8);
    header.writeUInt16LE(time, 10);
    header.writeUInt16LE(date, 12);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(zip64 ? U32 : body.length, 18);
    header.writeUInt32LE(zip64 ? U32 : data.length, 22);
    header.writeUInt16LE(nameBytes.length, 26);
    header.writeUInt16LE(extra.length, 28);
    const offset = this.offset;
    await this.write(header);
    await this.write(nameBytes);
    if (extra.length) await this.write(extra);
    await this.write(body);
    this.records.push({ name: nameBytes, method: useDeflate ? 8 : 0, crc, compressedSize: body.length, size: data.length, offset, time, date });
    this.names.add(name);
  }

  async close(): Promise<{ size: number; entries: number }> {
    const centralStart = this.offset;
    for (const record of this.records) {
      const fields: Buffer[] = [];
      const needSize = this.forceZip64 || record.size >= U32;
      const needCompressed = this.forceZip64 || record.compressedSize >= U32;
      const needOffset = this.forceZip64 || record.offset >= U32;
      if (needSize) fields.push(u64(record.size));
      if (needCompressed) fields.push(u64(record.compressedSize));
      if (needOffset) fields.push(u64(record.offset));
      const payload = Buffer.concat(fields);
      const extra = payload.length ? Buffer.concat([Buffer.from([ZIP64_EXTRA & 0xff, ZIP64_EXTRA >> 8, payload.length, 0]), payload]) : Buffer.alloc(0);
      const zip64 = extra.length > 0;
      const header = Buffer.alloc(46);
      header.writeUInt32LE(SIG_CENTRAL, 0);
      header.writeUInt16LE(zip64 ? 45 : 20, 4);
      header.writeUInt16LE(zip64 ? 45 : 20, 6);
      header.writeUInt16LE(UTF8_FLAG, 8);
      header.writeUInt16LE(record.method, 10);
      header.writeUInt16LE(record.time, 12);
      header.writeUInt16LE(record.date, 14);
      header.writeUInt32LE(record.crc, 16);
      header.writeUInt32LE(needCompressed ? U32 : record.compressedSize, 20);
      header.writeUInt32LE(needSize ? U32 : record.size, 24);
      header.writeUInt16LE(record.name.length, 28);
      header.writeUInt16LE(extra.length, 30);
      header.writeUInt32LE(needOffset ? U32 : record.offset, 42);
      await this.write(header);
      await this.write(record.name);
      if (extra.length) await this.write(extra);
    }
    const centralSize = this.offset - centralStart;
    const count = this.records.length;
    const zip64End = this.forceZip64 || count >= U16 || centralStart >= U32 || centralSize >= U32;
    if (zip64End) {
      const zip64EndOffset = this.offset;
      const record = Buffer.alloc(56);
      record.writeUInt32LE(SIG_ZIP64_EOCD, 0);
      record.writeBigUInt64LE(BigInt(44), 4);
      record.writeUInt16LE(45, 12);
      record.writeUInt16LE(45, 14);
      record.writeBigUInt64LE(BigInt(count), 24);
      record.writeBigUInt64LE(BigInt(count), 32);
      record.writeBigUInt64LE(BigInt(centralSize), 40);
      record.writeBigUInt64LE(BigInt(centralStart), 48);
      await this.write(record);
      const locator = Buffer.alloc(20);
      locator.writeUInt32LE(SIG_ZIP64_LOCATOR, 0);
      locator.writeBigUInt64LE(BigInt(zip64EndOffset), 8);
      locator.writeUInt32LE(1, 16);
      await this.write(locator);
    }
    const end = Buffer.alloc(22);
    end.writeUInt32LE(SIG_EOCD, 0);
    end.writeUInt16LE(zip64End ? U16 : count, 8);
    end.writeUInt16LE(zip64End ? U16 : count, 10);
    end.writeUInt32LE(zip64End ? U32 : centralSize, 12);
    end.writeUInt32LE(zip64End ? U32 : centralStart, 16);
    await this.write(end);
    await this.handle.sync().catch(() => undefined);
    await this.handle.close();
    return { size: this.offset, entries: count };
  }

  /** Yarım dosyayı kapatıp siler (hata yolunda). */
  async abort(): Promise<void> {
    await this.handle.close().catch(() => undefined);
    await unlink(this.path).catch(() => undefined);
  }
}

export interface ZipEntryInfo {
  name: string;
  method: number;
  crc: number;
  compressedSize: number;
  size: number;
  offset: number;
}

function readZip64Extra(extra: Buffer, wanted: { size: boolean; compressed: boolean; offset: boolean }) {
  let cursor = 0;
  while (cursor + 4 <= extra.length) {
    const id = extra.readUInt16LE(cursor);
    const length = extra.readUInt16LE(cursor + 2);
    if (id === ZIP64_EXTRA) {
      const field = extra.subarray(cursor + 4, cursor + 4 + length);
      let position = 0;
      const next = () => {
        if (position + 8 > field.length) throw new ZipFormatError("ZIP64 alanı eksik.");
        const value = Number(field.readBigUInt64LE(position));
        position += 8;
        return value;
      };
      return {
        size: wanted.size ? next() : undefined,
        compressed: wanted.compressed ? next() : undefined,
        offset: wanted.offset ? next() : undefined,
      };
    }
    cursor += 4 + length;
  }
  throw new ZipFormatError("ZIP64 alanı bulunamadı.");
}

export class ZipReader {
  private constructor(private readonly handle: FileHandle, private readonly entryMap: Map<string, ZipEntryInfo>, readonly fileSize: number) {}

  static async open(path: string): Promise<ZipReader> {
    let handle: FileHandle;
    try {
      handle = await open(path, "r");
    } catch {
      throw new ZipFormatError("Yedek dosyası açılamadı.");
    }
    try {
      const { size } = await handle.stat();
      if (size < 22) throw new ZipFormatError("Dosya geçerli bir ZIP değil.");
      const tailLength = Math.min(size, 22 + 0xffff);
      const tail = Buffer.alloc(tailLength);
      await handle.read(tail, 0, tailLength, size - tailLength);
      let eocd = -1;
      for (let i = tail.length - 22; i >= 0; i -= 1) {
        if (tail.readUInt32LE(i) === SIG_EOCD) {
          eocd = i;
          break;
        }
      }
      if (eocd === -1) throw new ZipFormatError("ZIP dizin kaydı bulunamadı.");
      let count = tail.readUInt16LE(eocd + 10);
      let centralSize = tail.readUInt32LE(eocd + 12);
      let centralStart = tail.readUInt32LE(eocd + 16);
      let centralLimit = size - tailLength + eocd;
      if (count === U16 || centralSize === U32 || centralStart === U32) {
        const locatorAt = size - tailLength + eocd - 20;
        if (locatorAt < 0) throw new ZipFormatError("ZIP64 dizin konumu bulunamadı.");
        const locator = Buffer.alloc(20);
        await handle.read(locator, 0, 20, locatorAt);
        if (locator.readUInt32LE(0) !== SIG_ZIP64_LOCATOR) throw new ZipFormatError("ZIP64 dizin konumu bulunamadı.");
        const recordAt = Number(locator.readBigUInt64LE(8));
        if (recordAt + 56 > locatorAt) throw new ZipFormatError("ZIP64 dizin kaydı bozuk.");
        const record = Buffer.alloc(56);
        await handle.read(record, 0, 56, recordAt);
        if (record.readUInt32LE(0) !== SIG_ZIP64_EOCD) throw new ZipFormatError("ZIP64 dizin kaydı bozuk.");
        count = Number(record.readBigUInt64LE(32));
        centralSize = Number(record.readBigUInt64LE(40));
        centralStart = Number(record.readBigUInt64LE(48));
        centralLimit = recordAt;
      }
      if (centralStart + centralSize > centralLimit) throw new ZipFormatError("ZIP dizini dosya sınırı dışında.");
      if (centralSize > 256 * 1024 * 1024) throw new ZipFormatError("ZIP dizini beklenenden büyük.");
      const central = Buffer.alloc(centralSize);
      await handle.read(central, 0, centralSize, centralStart);
      const entries = new Map<string, ZipEntryInfo>();
      let cursor = 0;
      for (let index = 0; index < count; index += 1) {
        if (cursor + 46 > central.length || central.readUInt32LE(cursor) !== SIG_CENTRAL) throw new ZipFormatError("ZIP dizini bozuk.");
        const method = central.readUInt16LE(cursor + 10);
        const crc = central.readUInt32LE(cursor + 16);
        let compressedSize = central.readUInt32LE(cursor + 20);
        let entrySize = central.readUInt32LE(cursor + 24);
        const nameLength = central.readUInt16LE(cursor + 28);
        const extraLength = central.readUInt16LE(cursor + 30);
        const commentLength = central.readUInt16LE(cursor + 32);
        let offset = central.readUInt32LE(cursor + 42);
        if (cursor + 46 + nameLength + extraLength + commentLength > central.length) throw new ZipFormatError("ZIP dizini bozuk.");
        const name = central.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8");
        if (entrySize === U32 || compressedSize === U32 || offset === U32) {
          const extra = central.subarray(cursor + 46 + nameLength, cursor + 46 + nameLength + extraLength);
          const values = readZip64Extra(extra, { size: entrySize === U32, compressed: compressedSize === U32, offset: offset === U32 });
          entrySize = values.size ?? entrySize;
          compressedSize = values.compressed ?? compressedSize;
          offset = values.offset ?? offset;
        }
        if (!isSafeZipName(name)) throw new ZipFormatError(`Güvensiz paket adı: ${name}`);
        if (method !== 0 && method !== 8) throw new ZipFormatError(`Desteklenmeyen sıkıştırma: ${name}`);
        if (offset + 30 + nameLength + compressedSize > centralStart) throw new ZipFormatError(`Girdi sınır dışında: ${name}`);
        if (entries.has(name)) throw new ZipFormatError(`Tekrarlanan girdi: ${name}`);
        entries.set(name, { name, method, crc, compressedSize, size: entrySize, offset });
        cursor += 46 + nameLength + extraLength + commentLength;
      }
      return new ZipReader(handle, entries, size);
    } catch (error) {
      await handle.close().catch(() => undefined);
      if (error instanceof ZipFormatError) throw error;
      throw new ZipFormatError("ZIP okunamadı.");
    }
  }

  entries(): ZipEntryInfo[] {
    return [...this.entryMap.values()];
  }

  has(name: string): boolean {
    return this.entryMap.has(name);
  }

  /** Girdiyi okur; CRC32 veya boyut tutmazsa hata verir. */
  async read(name: string): Promise<Buffer> {
    const entry = this.entryMap.get(name);
    if (!entry) throw new ZipFormatError(`Pakette yok: ${name}`);
    const header = Buffer.alloc(30);
    await this.handle.read(header, 0, 30, entry.offset);
    if (header.readUInt32LE(0) !== SIG_LOCAL) throw new ZipFormatError(`Girdi başlığı bozuk: ${name}`);
    const dataStart = entry.offset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
    if (dataStart + entry.compressedSize > this.fileSize) throw new ZipFormatError(`Girdi sınır dışında: ${name}`);
    const body = Buffer.alloc(entry.compressedSize);
    await this.handle.read(body, 0, entry.compressedSize, dataStart);
    let data: Buffer;
    try {
      data = entry.method === 8 ? inflateRawSync(body, { maxOutputLength: Math.max(entry.size, 1) }) : body;
    } catch {
      throw new ZipFormatError(`Girdi açılamadı: ${name}`);
    }
    if (data.length !== entry.size || crc32(data) !== entry.crc) throw new ZipFormatError(`Girdi bozuk (CRC): ${name}`);
    return data;
  }

  async close(): Promise<void> {
    await this.handle.close().catch(() => undefined);
  }
}
