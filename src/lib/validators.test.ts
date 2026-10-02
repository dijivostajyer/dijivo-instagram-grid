import { describe, expect, it } from "vitest";

import {
  MAX_IMAGE_BYTES,
  MAX_VIDEO_BYTES,
  loadVideoFile,
  looksLikeMp4,
  looksLikeWebm,
  validateImageFile,
  validateVideoFile,
  verifyVideoBytes,
} from "./validators";

function fakeFile(type: string, size: number): File {
  return { type, size } as unknown as File;
}

describe("validateImageFile", () => {
  it("JPEG, PNG ve WebP kabul eder", () => {
    expect(validateImageFile(fakeFile("image/jpeg", 1000)).ok).toBe(true);
    expect(validateImageFile(fakeFile("image/png", 1000)).ok).toBe(true);
    expect(validateImageFile(fakeFile("image/webp", 1000)).ok).toBe(true);
  });

  it("desteklenmeyen tür için Türkçe hata döndürür", () => {
    const result = validateImageFile(fakeFile("image/gif", 1000));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("Desteklenmeyen dosya türü");
  });

  it("10 MB üstü için boyut hatası döndürür", () => {
    const result = validateImageFile(
      fakeFile("image/png", MAX_IMAGE_BYTES + 1),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("çok büyük");
  });

  it("tam 10 MB kabul edilir", () => {
    expect(validateImageFile(fakeFile("image/png", MAX_IMAGE_BYTES)).ok).toBe(
      true,
    );
  });

  it("boş dosya için hata döndürür", () => {
    const result = validateImageFile(fakeFile("image/png", 0));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("Boş dosya");
  });
});

/** MP4: `ftyp` kutusu başlığı byte 4-8'de. */
const MP4_MAGIC = [
  0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d,
];
/** WebM: EBML başlık baytları 1A 45 DF A3. */
const WEBM_MAGIC = [0x1a, 0x45, 0xdf, 0xa3, 0x42, 0x82, 0x88, 0x4d];

function bytesOf(list: number[]): Uint8Array<ArrayBuffer> {
  const arr = new Uint8Array(list.length);
  for (let i = 0; i < list.length; i++) arr[i] = list[i];
  return arr;
}

function blobOf(list: number[], type: string): Blob {
  return new Blob([bytesOf(list)], { type });
}

function fakeVideoFile(type: string, size: number): File {
  return { type, size } as unknown as File;
}

describe("reel video doğrulama (§3/§22)", () => {
  it("geçerli MP4 magic byte'ları kabul edilir", () => {
    expect(looksLikeMp4(bytesOf(MP4_MAGIC))).toBe(true);
    expect(looksLikeMp4(bytesOf([0, 0, 0, 0, 0x66, 0x74, 0x79, 0x70]))).toBe(
      true,
    );
  });

  it("geçerli WebM magic byte'ları kabul edilir", () => {
    expect(looksLikeWebm(bytesOf(WEBM_MAGIC))).toBe(true);
  });

  it("geçersiz magic byte reddedilir (§22: invalid video magic byte)", () => {
    expect(looksLikeMp4(bytesOf(WEBM_MAGIC))).toBe(false);
    expect(looksLikeWebm(bytesOf(MP4_MAGIC))).toBe(false);
    // PNG baytları MP4 olarak reddedilmeli.
    expect(looksLikeMp4(bytesOf([0x89, 0x50, 0x4e, 0x47]))).toBe(false);
    // Çok kısa girdiler reddedilmeli.
    expect(looksLikeMp4(bytesOf([0x66, 0x74, 0x79, 0x70]))).toBe(false);
    expect(looksLikeWebm(bytesOf([0x1a, 0x45]))).toBe(false);
  });

  it("MP4/WebM kabul edilir; boyut sınırı 100 MB (§22: video size limit)", () => {
    expect(validateVideoFile(fakeVideoFile("video/mp4", 1000)).ok).toBe(true);
    expect(validateVideoFile(fakeVideoFile("video/webm", 1000)).ok).toBe(true);
    expect(
      validateVideoFile(fakeVideoFile("video/mp4", MAX_VIDEO_BYTES)).ok,
    ).toBe(true);
    const tooBig = validateVideoFile(
      fakeVideoFile("video/mp4", MAX_VIDEO_BYTES + 1),
    );
    expect(tooBig.ok).toBe(false);
    if (!tooBig.ok) expect(tooBig.error).toContain("çok büyük");
  });

  it("desteklenmeyen video türü ve boş dosya reddedilir", () => {
    const wrongType = validateVideoFile(fakeVideoFile("video/quicktime", 1000));
    expect(wrongType.ok).toBe(false);
    if (!wrongType.ok) expect(wrongType.error).toContain("Desteklenmeyen");
    const empty = validateVideoFile(fakeVideoFile("video/mp4", 0));
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.error).toContain("Boş dosya");
  });

  it("verifyVideoBytes: MIME ile magic-byte eşleşmesini kontrol eder", async () => {
    expect(await verifyVideoBytes(blobOf(MP4_MAGIC, "video/mp4"))).toBe(true);
    expect(await verifyVideoBytes(blobOf(WEBM_MAGIC, "video/webm"))).toBe(true);
    // Sahte uzantı: WebM baytları MP4 olarak etiketlenmiş.
    expect(await verifyVideoBytes(blobOf(WEBM_MAGIC, "video/mp4"))).toBe(
      false,
    );
    // PNG baytları MP4 olarak etiketlenmiş.
    expect(
      await verifyVideoBytes(
        blobOf([0x89, 0x50, 0x4e, 0x47], "video/mp4"),
      ),
    ).toBe(false);
    // Boş blob.
    expect(await verifyVideoBytes(new Blob([], { type: "video/mp4" }))).toBe(
      false,
    );
  });

  it("loadVideoFile: geçerli MP4 için object URL üretir; bozuk video reddedilir", async () => {
    const valid = new File([bytesOf(MP4_MAGIC)], "reel.mp4", {
      type: "video/mp4",
    });
    const { url } = await loadVideoFile(valid);
    expect(url.startsWith("blob:")).toBe(true);
    URL.revokeObjectURL(url);

    const corrupt = new File([bytesOf(MP4_MAGIC)], "reel.webm", {
      type: "video/webm",
    });
    await expect(loadVideoFile(corrupt)).rejects.toThrow(
      "Video dosyası bozuk",
    );

    const wrongType = new File([bytesOf(MP4_MAGIC)], "reel.gif", {
      type: "video/gif",
    });
    await expect(loadVideoFile(wrongType)).rejects.toThrow(
      "Desteklenmeyen dosya türü",
    );
  });
});
