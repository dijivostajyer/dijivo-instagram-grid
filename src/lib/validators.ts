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
