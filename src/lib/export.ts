import { PDFDocument, rgb, PDFFont } from "pdf-lib";
import { open } from "node:fs/promises";

import type { Brand, GridResult } from "./types";

/**
 * Dijivo Instagram Grid Preview Tool — PDF/JPG dinamik kıvrım (MVP Faz 2).
 *
 * - Tarayıcıda çalışır; tek bağımlı kütüphane `pdf-lib` (AMD/UMD, bundeleyerek).
 * - Export sırasında `@/lib/grid`'nin `computeGrid` sonucuyla birebir aynı grid
 *   hesaplanır: `cells` sırası korunur (pinned, planlanan, mevcut).
 * - Görseller `loadImageFile` tarafından üretilen Object URL'dir; export sırasında
 *   `fetch` ile `Image` objesine yüklenir, orijinal dosya hiç değişmez.
 *   1:1 kırpma `object-cover` mantığıyla merkezden kırpılır.
 * - File adı `slugify(brand.name)` ile oluşturulur; güvenli olmayan karakterler
 *   `_` ile değiştirilir.
 */

const FONT_PATHS = {
  regular: new URL("../assets/fonts/DejaVuSans.ttf", import.meta.url).pathname,
  bold: new URL("../assets/fonts/DejaVuSans-Bold.ttf", import.meta.url).pathname,
  oblique: new URL("../assets/fonts/DejaVuSans-Oblique.ttf", import.meta.url).pathname,
} as const;

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

type FontBundle = {
  regular: PDFFont;
  bold: PDFFont;
  oblique: PDFFont;
};

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
  const images = await Promise.all(imageUrls.map(loadImageAsElement));
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
 * PDF içeriği.
 */
export async function buildPdfBytes(
  brand: Brand,
  result: GridResult,
  imageElements: Promise<HTMLImageElement>[],
): Promise<Uint8Array> {
  const images = await Promise.all(imageElements);

  const pageCount = Math.max(1, Math.ceil(result.cells.length / GRID_COLUMNS));
  const pdfDoc = await PDFDocument.load(2480, 3508);
  const fontBundle = await loadFontBundle(pdfDoc);

  for (let page = 0; page < pageCount; page += 1) {
    const pageRect = { x: 0, y: A4_H, width: A4_W, height: A4_H };

    // Header (marka + bio) her sayfanın başında
    const headerY = A4_H - HEADER_PADDING;
    await drawHeader(pdfDoc, pageRect, headerY, brand, fontBundle);

    // Grid
    const gridY = Math.min(headerY - GRID_LEADING, pageRect.height - FOOTER_LEADING - GRID_LEADING);
    const rowCount = Math.ceil(result.cells.length / GRID_COLUMNS);
    const gridYEnd = gridY - rowCount * (GRID_COLUMNS + GRID_LEADING);
    await drawGrid(
      pdfDoc,
      pageRect,
      gridYEnd,
      result,
      images,
      fontBundle,
      page + 1,
      pageCount,
    );

    // Footer
    const footerY = HEADER_PADDING + 12;
    await drawFooter(pdfDoc, pageRect, footerY, brand);

    // İçerik bittiğinde şartı kontrol et
    if (pageCount > 1 && page < pageCount - 1) {
      pdfDoc.addPage();
    }
  }

  const bytes = pdfDoc.save();
  return bytes;
}

async function loadFontBundle(pdfDoc: PDFDocument): Promise<FontBundle> {
  const regular = await pdfDoc.embedFont(await readFont(FONT_PATHS.regular));
  const bold = await pdfDoc.embedFont(await readFont(FONT_PATHS.bold));
  const oblique = await pdfDoc.embedFont(await readFont(FONT_PATHS.oblique));
  return { regular, bold, oblique };
}

async function readFont(filePath: string): Promise<Buffer> {
  const file = await open(filePath, "r");
  const buf = Buffer.from(await file.readFile());
  await file.close();
  return buf;
}

async function drawHeader(
  pdfDoc: PDFDocument,
  rect: { x: number; y: number; width: number; height: number },
  headerY: number,
  brand: Brand,
  fonts: FontBundle,
) {
  if (brand.profileImageUrl) {
    const img = new Image();
    img.src = brand.profileImageUrl;
    const size = 48;
    const x = rect.x + (rect.width - size) / 2;
    const y = headerY - size;
    const page = await pdfDoc.addPage();
    const pdfImage = await pdfDoc.embedPng(await fetchImageBuffer(img.src));
    page.drawImage(pdfImage, {
      x,
      y,
      width: size,
      height: size,
    });
  } else {
    const size = 48;
    const x = rect.x + (rect.width - size) / 2;
    const y = headerY - size;
    const page = await pdfDoc.addPage();
    page.drawRectangle({
      x,
      y,
      width: size,
      height: size,
      color: rgb(0.9, 0.9, 0.9),
    });
  }

  const font = fonts.bold;
  const page = await pdfDoc.addPage();
  page.drawText(brand.name, {
    x: rect.x + 72,
    y: headerY - 12,
    size: 20,
    font,
    color: rgb(0.1, 0.1, 0.1),
  });
  page.drawText(`@${brand.username}`, {
    x: rect.x + 72,
    y: headerY - 34,
    size: 14,
    font,
    color: rgb(0.4, 0.4, 0.4),
  });

  if (brand.bio) {
    const lines = wrapText(brand.bio, 90, 14, fonts.regular);
    let lineY = headerY - 52;
    for (const line of lines) {
      const page = await pdfDoc.addPage();
      page.drawText(line, {
        x: rect.x + 72,
        y: lineY,
        size: 14,
        font: fonts.regular,
        color: rgb(0.35, 0.35, 0.35),
      });
      lineY -= 18;
    }
  }
}

async function drawGrid(
  pdfDoc: PDFDocument,
  rect: { x: number; y: number; width: number; height: number },
  gridYEnd: number,
  result: GridResult,
  images: Promise<HTMLImageElement>[],
  fonts: FontBundle,
  pageNumber: number,
  pageCount: number,
) {
  const { cells, rowCount } = result;
  const cellWidth = (rect.width - GRID_LEADING * (GRID_COLUMNS - 1)) / GRID_COLUMNS;

  for (let i = 0; i < cells.length; i += 1) {
    const cell = cells[i];
    const x = rect.x + cell.column * (cellWidth + GRID_LEADING);
    const y = gridYEnd + cell.row * (cellWidth + GRID_LEADING);

    const page = await pdfDoc.addPage();
    page.drawRectangle({
      x,
      y,
      width: cellWidth,
      height: cellWidth,
      color: rgb(0.96, 0.96, 0.96),
      borderColor: rgb(0.85, 0.85, 0.85),
      borderWidth: 0.5,
    });

    const img = await images[i];
    const pdfImage = await pdfDoc.embedPng(await fetchImageBuffer(img.src));
    const aspect = pdfImage.width / pdfImage.height;
    const drawWidth = cellWidth;
    const drawHeight = drawWidth / aspect;
    const drawX = x + (cellWidth - drawWidth) / 2;
    const drawY = y + (cellWidth - drawHeight) / 2;

    page.drawImage(pdfImage, {
      x: drawX,
      y: drawY,
      width: drawWidth,
      height: drawHeight,
    });

    if (cell.pinned) {
      page.drawText("📌", {
        x: x + 4,
        y: y + 4,
        size: 12,
        font: fonts.bold,
        color: rgb(0.1, 0.1, 0.1),
      });
    }

    if (cell.post.source === "planlanan") {
      page.drawText("PLAN", {
        x: x + 4,
        y: y + 4,
        size: 10,
        font: fonts.regular,
        color: rgb(0.1, 0.1, 0.1),
      });
    }
  }

  const page = await pdfDoc.addPage();
  page.drawText(
    `Sayfa ${pageNumber} / ${pageCount}`,
    {
      x: rect.x + 8,
      y: 8,
      size: 9,
      font: fonts.regular,
      color: rgb(0.7, 0.7, 0.7),
    },
  );
}

async function drawFooter(
  pdfDoc: PDFDocument,
  rect: { x: number; y: number; width: number; height: number },
  footerY: number,
  brand: Brand,
  fonts: FontBundle,
) {
  const page = await pdfDoc.addPage();
  page.drawText(
    `Dijivo Grid Preview · ${brand.name} · ${brand.username}`,
    {
      x: rect.x + 8,
      y: footerY,
      size: 9,
      font: fonts.regular,
      color: rgb(0.6, 0.6, 0.6),
    },
  );
}

function wrapText(text: string, maxChars: number, size: number, font: unknown): string[] {
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

async function fetchImageBuffer(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("Görsel dosyası indirilemedi.");
  }
  const buffer = await response.arrayBuffer();
  return new Uint8Array(buffer);
}

/**
 * JPG (resim) çıktısı.
 */
export async function buildJpgBytes(
  brand: Brand,
  result: GridResult,
  imageElements: Promise<HTMLImageElement>[],
): Promise<BlobPart> {
  // JPG için canvas dökümü; PDF'den bağımsız.
  return new Uint8Array();
}
