/**
 * Görsel dosyası doğrulama kuralları (MVP).
 * Tüm mesajlar son kullanıcıya gösterilecek Türkçe mesajlardır.
 */

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB
/** Instagram'ın desteklediği ve aracın kabul ettiği türler */
export const SUPPORTED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export type ImageValidationResult =
  | { ok: true }
  | { ok: false; error: string };

export function validateImageFile(file: File): ImageValidationResult {
  if (!SUPPORTED_IMAGE_TYPES.includes(file.type as never)) {
    return {
      ok: false,
      error:
        "Desteklenmeyen dosya türü. Lütfen JPG, PNG veya WebP biçiminde bir görsel yükleyin.",
    };
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return {
      ok: false,
      error:
        "Dosya çok büyük. En fazla 10 MB boyutunda bir görsel yükleyebilirsiniz.",
    };
  }
  if (file.size === 0) {
    return {
      ok: false,
      error: "Boş dosya yüklenemez. Lütfen geçerli bir görsel seçin.",
    };
  }
  return { ok: true };
}

/**
 * Reel video doğrulama (Phase 2, §5).
 * Minimum güvenli format: MP4 / WebM.
 */
export const MAX_VIDEO_BYTES = 100 * 1024 * 1024; // 100 MB
/** İnternette en yaygın, tarayıcı destekli video konteynerleri. */
export const SUPPORTED_VIDEO_TYPES = [
  "video/mp4",
  "video/webm",
] as const;

/** Reel kapak görseli için kabul edilen türler (JPG/PNG/WebP). */
export const SUPPORTED_COVER_TYPES = SUPPORTED_IMAGE_TYPES;

export type VideoValidationResult =
  | { ok: true }
  | { ok: false; error: string };

/** MP4: `ftyp` kutusu başlıkta (byte 4-8); 8 bayt yeterlidir. */
export function looksLikeMp4(bytes: Uint8Array): boolean {
  if (bytes.length < 8) return false;
  return (
    bytes[4] === 0x66 && // f
    bytes[5] === 0x74 && // t
    bytes[6] === 0x79 && // y
    bytes[7] === 0x70 // p
  );
}

/** WebM: EBML başlık baytları 1A 45 DF A3. */
export function looksLikeWebm(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x1a &&
    bytes[1] === 0x45 &&
    bytes[2] === 0xdf &&
    bytes[3] === 0xa3
  );
}

/**
 * Reel video dosyasını doğrular: MIME + magic-byte eşleşmesi
 * ve boyut sınırı. Dosya içeriği hiçbir şekilde değiştirilmez.
 */
export function validateVideoFile(file: File): VideoValidationResult {
  if (!SUPPORTED_VIDEO_TYPES.includes(file.type as never)) {
    return {
      ok: false,
      error:
        "Desteklenmeyen dosya türü. Lütfen MP4 veya WebM biçiminde bir video yükleyin.",
    };
  }
  if (file.size === 0) {
    return {
      ok: false,
      error: "Boş dosya yüklenemez. Lütfen geçerli bir video seçin.",
    };
  }
  if (file.size > MAX_VIDEO_BYTES) {
    return {
      ok: false,
      error:
        "Dosya çok büyük. En fazla 100 MB boyutında bir video yükleyebilirsiniz.",
    };
  }
  return { ok: true };
}

/**
 * Reel videosunun gerçek içeriğini magic-byte ile kontrol eder
 * (MIME'ten bağımsız, sahte uzantıya karşı). Blob okunabilir
 *sebepsiz reddedilirse `false` döner; hata mesajı üretmez.
 */
export async function verifyVideoBytes(
  blob: Blob,
): Promise<boolean> {
  if (blob.size === 0) return false;
  const head = await blob.slice(0, 12).arrayBuffer();
  const bytes = new Uint8Array(head);
  const mp4 = looksLikeMp4(bytes);
  const webm = looksLikeWebm(bytes);
  if (blob.type === "video/mp4") return mp4;
  if (blob.type === "video/webm") return webm;
  return mp4 || webm;
}

/**
 * Reel videosunu doğrular, object URL'e çevirir.
 * Orijinal dosya hiçbir biçimde değiştirilmez; yalnızca
 * tarayıcıda önizlenir. Hata durumunda URL geri alınır.
 */
export async function loadVideoFile(file: File): Promise<{ url: string }> {
  const validation = validateVideoFile(file);
  if (!validation.ok) throw new Error(validation.error);
  const url = URL.createObjectURL(file);
  try {
    const valid = await verifyVideoBytes(file);
    if (!valid) {
      throw new Error(
        "Video dosyası bozuk veya desteklenmiyor. Lütfen geçerli bir MP4/WebM dosyası deneyin.",
      );
    }
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
  return { url };
}

/** Reel kapak görselini doğrular ve object URL'e çevirir (JPG/PNG/WebP). */
export async function loadCoverFile(file: File): Promise<{ url: string; alt: string }> {
  const validation = validateImageFile(file);
  if (!validation.ok) throw new Error(validation.error);
  const url = URL.createObjectURL(file);
  try {
    await decodeImage(url);
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
  return { url, alt: file.name };
}

/** Yüklenen görselin tarayıcıda açılıp açılmadığını kontrol eder (decode testi). */
export function decodeImage(objectUrl: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve();
    img.onerror = () =>
      reject(
        new Error(
          "Görsel yüklenemedi. Dosya bozuk olabilir; lütfen farklı bir görsel deneyin.",
        ),
      );
    img.src = objectUrl;
  });
}

/**
 * Dosyayı doğrular, object URL'e çevirir ve decode testinden geçirir.
 * Orijinal dosya hiçbir biçimde değiştirilmez; yalnızca tarayıcıda önizlenir.
 * Hata durumunda oluşturulan URL geri alınır (revoke).
 */
export async function loadImageFile(
  file: File,
): Promise<{ url: string; alt: string; aspectRatio: "1:1" | "3:4" | "4:3" | "16:9" }> {
  const validation = validateImageFile(file);
  if (!validation.ok) throw new Error(validation.error);
  const url = URL.createObjectURL(file);
  try {
    await decodeImage(url);
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
  const aspectRatio = await detectAspectRatio(url);
  return { url, alt: file.name, aspectRatio };
}

/** Kaynak oranını metadata olarak korur; grid önizlemesi Instagram gibi 1:1 kalır. */
function detectAspectRatio(url: string): Promise<"1:1" | "3:4" | "4:3" | "16:9"> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      const ratio = image.naturalWidth / image.naturalHeight;
      const candidates = [
        [1, "1:1"], [3 / 4, "3:4"], [4 / 3, "4:3"], [16 / 9, "16:9"],
      ] as const;
      resolve(candidates.reduce((best, candidate) => Math.abs(ratio - candidate[0]) < Math.abs(ratio - best[0]) ? candidate : best)[1]);
    };
    image.onerror = () => resolve("1:1");
    image.src = url;
  });
}
