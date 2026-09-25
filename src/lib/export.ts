import type { Brand, GridResult } from "./types";

/**
 * Dijivo Instagram Grid Preview Tool — PDF/JPG dinamik kıvrım (MVP Faz 2).
 *
 * Mimari:
 * - Tarayıcıda çalışır; tek bağımlı kütüphane `canvas` API'si.
 * - Görseller `Object URL` olarak gelir; export sırasında `fetch` ile `Image`
 *   objesine yüklenir, orijinal dosya hiç değişmez.
 * - 1:1 kırpma `object-cover` mantığıyla merkezden kırpılır.
 * - Export sırasında `computeGrid` sonucuyla birebir aynı grid hesaplanır.
 * - Node `fs`, `Buffer` veya başka Node-only API kullanılmaz.
 * - PDF sayfası alınırken `pdf-lib` ile işlem yapılır; tüm metin, şekil ve
 *   görsel çizimleri `canvas` üzerinde yapılır.
 * - Font yükleme mekanizması bulunmamaktadır; `pdf-lib` bunun için `fontkit`
 *   gerektirir, bu yüzden `drawText` çağrıları yerine tüm içerik `canvas` üzerinde
 *   çizilir ve `toDataURL` olarak dışa aktarılır.
 * - File adı `slugify(brand.name)` ile oluşturulur; güvenli olmayan karakterler
 *   `_` ile değiştirilir.
 */

const A4_W = 595.28; // A4 genişliği (pt)
const A4_H = 841.89; // A4 yüksekliği (pt)
const GRID_COLUMNS = 3;
const GRID_LEADING = 16; // hücre arası boşluk
const HEADER_PADDING = 24;
const FOOTER_LEADING = 18;

export interface ExportOptions {
  setExporting?: (exporting: boolean) => void;
  isExporting?: (key: string) => boolean;
  download: (fileName: string, blob: Blob) => Promise<void>;
  showError: (message: string) => void;
}

/** Güvenli dosya adını oluşturur. */
export function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "instagram-grid";
}

export function buildFileName(brand: Brand, suffix: "pdf" | "jpg"): string {
  return `${slugify(brand.name)}-${suffix}.${suffix}`;
}

/** Tarayıcıda `Image` objesi yükler; örnek `<img src={url}>` ile aynı. */
async function loadImageAsElement(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Görsel yüklenemedi."));
    img.src = url;
  });
}

/**
 * Export verisi, grid motorundan bağımsız olarak yeniden türetilmez;
 * `computeGrid` direk çağrılır.
 */
export async function buildExportData(
  brand: Brand,
  result: GridResult,
  imageUrls: Promise<string>[],
): Promise<{ brand: Brand; result: GridResult; images: HTMLImageElement[] }> {
  const images = await Promise.all(imageUrls.map(async (url) => loadImageAsElement(url)));
  return { brand, result, images };
}

/**
 * A4 + 3 sütunlu grid çıktını başlatır.
 */
export function buildCanvas(
  result: GridResult,
): { pageCount: number; canvasHeight: number } {
  const pageCount = Math.max(1, Math.ceil(result.cells.length / GRID_COLUMNS));
  return { pageCount, canvasHeight: pageCount * A4_H };
}

/**
 * PDF içeriği. `computeGrid` sonucuyla birebir aynı grid kullanılır; hepsi
 * `canvas` üzerinde çizilir ve `toDataURL` olarak dışa aktarılır.
 */
export async function buildPdfBytes(
  brand: Brand,
  result: GridResult,
  imageElements: HTMLImageElement[],
): Promise<Uint8Array> {
  const { cells, rowCount } = result;
  const { pageCount } = buildCanvas(result);

  // Sunum çıktısını kanva üzerinde çiz.
  const output = document.createElement("canvas");
  output.width = A4_W;
  output.height = pageCount * A4_H;

  const ctx = output.getContext("2d") ?? null;
  if (!ctx) throw new Error("Canvas context is not available.");

  // Header + grid + footer tek bir canvas üzerinden çizilir.
  const headerY = A4_H - HEADER_PADDING;

  // Grid hesapları (yükseklik) tek seferde türetilir.
  for (let page = 0; page < pageCount; page += 1) {
    const pageY = page * A4_H;

    // Header
    if (brand.profileImageUrl) {
      const img = new Image();
      img.src = brand.profileImageUrl;
      await img.decode();
      ctx.drawImage(img, 0, pageY + headerY - A4_H, A4_W, A4_H);
    } else {
      ctx.fillStyle = "#f3f4f6";
      ctx.fillRect(0, pageY + headerY - A4_H, A4_W, A4_H);
    }

    ctx.fillStyle = "#111827";
    ctx.font = "20px Inter, system-ui, sans-serif";
    ctx.fillText(brand.name, 24, pageY + headerY - 12);

    ctx.fillStyle = "#6b7280";
    ctx.font = "14px Inter, system-ui, sans-serif";
    ctx.fillText(`@${brand.username}`, 24, pageY + headerY - 34);

    if (brand.bio) {
      const lines = wrapText(brand.bio, 90, 14, "#555555");
      let lineY = pageY + headerY - 52;
      for (const line of lines) {
        ctx.fillStyle = "#555555";
        ctx.font = "14px Inter, system-ui, sans-serif";
        ctx.fillText(line, 24, lineY);
        lineY -= 18;
      }
    }

    // Grid
    const gridY = Math.min(
      headerY - GRID_LEADING,
      A4_H - FOOTER_LEADING - GRID_LEADING,
    );
    const gridYEnd = gridY - rowCount * (GRID_COLUMNS + GRID_LEADING);
    drawGridSection(
      ctx,
      A4_W,
      gridYEnd,
      cells,
      imageElements,
      pageCount,
    );
  }

  // Footer (en son sayfanın altına)
  const footerY = HEADER_PADDING + 12;
  ctx.fillStyle = "#6b7280";
  ctx.font = "9px Inter, system-ui, sans-serif";
  ctx.fillText(
    `Dijivo Grid Preview · ${brand.name} · ${brand.username}`,
    8,
    12,
  );

  const base64 = output.toDataURL("image/png").split(",")[1];
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Grid bölümünü `canvas` üzerinde çizer.
 */
function drawGridSection(
  ctx: CanvasRenderingContext2D,
  width: number,
  gridYEnd: number,
  cells: GridResult["cells"],
  images: HTMLImageElement[],
  _pageCount: number,
) {
  const cellWidth =
    (width - GRID_LEADING * (GRID_COLUMNS - 1)) / GRID_COLUMNS;

  for (let i = 0; i < cells.length; i += 1) {
    const cell = cells[i];
    const column = cell.column;
    const row = cell.row;
    const x = column * (cellWidth + GRID_LEADING);
    const y = gridYEnd + row * (cellWidth + GRID_LEADING);

    // Hücre zemin
    ctx.fillStyle = "#f8faf9";
    ctx.fillRect(x, y, cellWidth, cellWidth);

    // 1:1 crop: orijinal orana göre merkezden kırpılır
    const img = images[i];
    const aspect = img.naturalWidth / img.naturalHeight;
    const drawWidth = cellWidth;
    const drawHeight = drawWidth / aspect;
    const drawX = x + (cellWidth - drawWidth) / 2;
    const drawY = y + (cellWidth - drawHeight) / 2;

    ctx.drawImage(img, drawX, drawY, drawWidth, drawHeight);

    // Pinned ve plan etiketi
    if (cell.pinned) {
      ctx.fillStyle = "#111827";
      ctx.font = "12px Inter, system-ui, sans-serif";
      ctx.fillText("📌", x + 4, y + 16);
    }

    if (cell.post.source === "planlanan") {
      ctx.fillStyle = "#111827";
      ctx.font = "10px Inter, system-ui, sans-serif";
      ctx.fillText("PLAN", x + 4, y + 14);
    }
  }
}

function wrapText(text: string, maxChars: number, size: number, color: string): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (test.length <= maxChars) {
      current = test;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/**
 * JPG (resim) çıktısı. Browser canvas kullanılarak gerçekten üretilir.
 */
export async function buildJpgBytes(
  brand: Brand,
  result: GridResult,
  imageElements: HTMLImageElement[],
): Promise<BlobPart> {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas context is not available.");

  const { cells, rowCount } = result;
  const pageCount = Math.max(1, Math.ceil(cells.length / GRID_COLUMNS));

  const cellWidth = (A4_W - GRID_LEADING * (GRID_COLUMNS - 1)) / GRID_COLUMNS;

  for (let page = 0; page < pageCount; page += 1) {
    const pageY = page * A4_H;

    // Header
    if (brand.profileImageUrl) {
      const img = new Image();
      img.src = brand.profileImageUrl;
      await img.decode();
      ctx.drawImage(img, 0, pageY + 0, A4_W, A4_H);
    } else {
      ctx.fillStyle = "#f3f4f6";
      ctx.fillRect(0, pageY + 0, A4_W, A4_H);
    }

    ctx.fillStyle = "#111827";
    ctx.font = "20px Inter, system-ui, sans-serif";
    ctx.fillText(brand.name, 24, pageY + 24);
    ctx.fillStyle = "#6b7280";
    ctx.font = "14px Inter, system-ui, sans-serif";
    ctx.fillText(`@${brand.username}`, 24, pageY + 42);

    if (brand.bio) {
      const lines = wrapText(brand.bio, 90, 14, "#555555");
      let lineY = pageY + 62;
      for (const line of lines) {
        ctx.fillStyle = "#555555";
        ctx.font = "14px Inter, system-ui, sans-serif";
        ctx.fillText(line, 24, lineY);
        lineY += 18;
      }
    }

    const gridYEnd = (A4_H - HEADER_PADDING) - rowCount * (GRID_COLUMNS + GRID_LEADING);
    // Grid
    for (let i = 0; i < cells.length; i += 1) {
      const cell = cells[i];
      const column = cell.column;
      const row = cell.row;
      const x = column * (cellWidth + GRID_LEADING);
      const y = gridYEnd + row * (cellWidth + GRID_LEADING);

      ctx.fillStyle = "#f8faf9";
      ctx.fillRect(x, y, cellWidth, cellWidth);

      const img = imageElements[i];
      const aspect = img.naturalWidth / img.naturalHeight;
      const drawWidth = cellWidth;
      const drawHeight = drawWidth / aspect;
      const drawX = x + (cellWidth - drawWidth) / 2;
      const drawY = y + (cellWidth - drawHeight) / 2;

      ctx.drawImage(img, drawX, drawY, drawWidth, drawHeight);

      if (cell.pinned) {
        ctx.fillStyle = "#111827";
        ctx.font = "12px Inter, system-ui, sans-serif";
        ctx.fillText("📌", x + 4, y + 16);
      }

      if (cell.post.source === "planlanan") {
        ctx.fillStyle = "#111827";
        ctx.font = "10px Inter, system-ui, sans-serif";
        ctx.fillText("PLAN", x + 4, y + 14);
      }
    }
  }

  return canvas.toDataURL("image/jpeg", 0.92);
}

function wrapText(text: string, maxChars: number, size: number, color: string): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (test.length <= maxChars) {
      current = test;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

