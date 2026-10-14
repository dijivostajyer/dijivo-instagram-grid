import { PDFDocument } from "pdf-lib";
import type { Brand, GridResult } from "./types";
import { gridCellHeightRatio, isReelCell, MAX_CELL_HEIGHT_RATIO } from "./grid-ratio";

/** A4 dimensions in points (ISO 216). */
export const A4_W = 595.28;
export const A4_H = 841.89;

/**
 * Export canvas scale: pixel size = A4 * EXPORT_SCALE, so the JPG output is
 * 300 DPI A4 raster (2480x3508) while drawing stays in A4 point coordinates.
 */
export const EXPORT_SCALE = 300 / 72;

/** Tek yerde tanımlı, marka bağımsız export kimliği. */
export const EXPORT_BRANDING = "Dijivo Grid Preview";

/** Header/footer band heights of one export page (A4 points). */
export const HEADER_HEIGHT = 140;
export const FOOTER_HEIGHT = 30;

/** Vertical grid area of one A4 page: between header and footer. */
export const GRID_TOP = HEADER_HEIGHT;
export const GRID_BOTTOM = A4_H - FOOTER_HEIGHT;

/** Grid configuration used by both UI and export. */
export const GRID_COLUMNS = 3;
export const GRID_LEADING = 16; // horizontal/vertical gap between grid cells

export interface ExportOptions {
  setExporting?: (exporting: boolean) => void;
  isExporting?: (key: string) => boolean;
  download: (fileName: string, blob: Blob) => Promise<void>;
  showError: (message: string) => void;
}

/**
 * Safe file name.
 * Turkish-aware slugification: ı→i, İ→i, ş→s, Ş→s, ğ→g, Ğ→g, ü→u, Ü→u,
 * ö→o, Ö→o, ç→c, Ç→c. Non-alphanumeric separators become "-", repeated dashes
 * collapse, and leading/trailing dashes are stripped. Falls back to a safe name
 * when the result is empty.
 */
export function slugify(value: string): string {
  const lowered = value.trim().toLowerCase();
  const transliterated = lowered
    .replace(/ı/g, "i")
    .replace(/İ/g, "i")
    .replace(/ğ/g, "g")
    .replace(/Ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/Ü/g, "u")
    .replace(/ö/g, "o")
    .replace(/Ö/g, "o")
    .replace(/ç/g, "c")
    .replace(/Ç/g, "c");
  return (
    transliterated
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "instagram-grid"
  );
}

export function buildFileName(brand: Brand, suffix: "pdf" | "jpg"): string {
  return `${slugify(brand.name)}.${suffix}`;
}

/**
 * Export kullanılabilirliği. Boş gridde boş PDF/JPG üretilmez:
 * butonlar devre dışı bırakılır ve kullanıcıya açıklama gösterilir.
 */
export function getExportAvailability(cellCount: number): {
  enabled: boolean;
  message: string;
} {
  if (cellCount > 0) {
    return { enabled: true, message: "" };
  }
  return {
    enabled: false,
    message:
      "Grid boş: dışa aktarmak için en az bir mevcut veya planlanan gönderi ekleyin.",
  };
}

async function loadImageAsElement(url: string): Promise<HTMLImageElement> {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    // CORS mode: without it a cross-origin image taints the canvas and
    // `canvas.toBlob` fails with a SecurityError during export.
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Görsel yüklenemedi."));
    img.src = url;
  });
}

/**
 * Sanitize a hex color string. Accepts `#rgb`, `#rrggbb`, `rgb(...)`, or a raw
 * CSS color name. Falls back to `#ffffff` on any parse failure.
 */
export function normalizeColor(value: string, fallback = "#ffffff"): string {
  if (!value) return fallback;

  const trimmed = value.trim();

  // Already a plain name.
  if (!trimmed.startsWith("#") && !trimmed.startsWith("rgb(")) return trimmed;

  // #rgb or #rrggbb
  if (trimmed.startsWith("#")) {
    const hex = trimmed.slice(1);
    if (/^[0-9a-f]{3}$|^[0-9a-f]{6}$/i.test(hex)) return trimmed.toLowerCase();
    return fallback;
  }

  // rgb(...)
  const match = trimmed.match(/^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i);
  if (match) {
    const [_, r, g, b] = match.map(Number);
    if (r >= 0 && r <= 255 && g >= 0 && g <= 255 && b >= 0 && b <= 255) {
      return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
    }
  }

  return fallback;
}

/** A4 page geometry: rows that fit between the given grid bounds. */
export function calculatePagination(
  cells: GridResult["cells"],
  cellSize: number,
  gridTop: number,
  gridBottom: number,
): { rowsPerPage: number; cellsPerPage: number; pageCount: number } {
  const usableHeight = gridBottom - gridTop;
  const rowsPerPage = Math.max(
    1,
    Math.floor((usableHeight + GRID_LEADING) / (cellSize + GRID_LEADING)),
  );
  const cellsPerPage = rowsPerPage * GRID_COLUMNS;
  const pageCount = Math.max(1, Math.ceil(cells.length / cellsPerPage));
  return { rowsPerPage, cellsPerPage, pageCount };
}

/** Export sayfasında sabit satır sayısı: 3 satır × 3 kolon = 9 hücre/sayfa. */
export const EXPORT_ROWS_PER_PAGE = 3;

export interface ExportLayout {
  /** Tüm hücrelerin ortak genişliği (A4 pt). */
  cellWidth: number;
  /** Grid A4 genişliğinde ortalanır; soldaki boşluk (A4 pt). */
  offsetX: number;
  rowsPerPage: number;
  cellsPerPage: number;
  pageCount: number;
}

/**
 * Post 3:4 / Reel 2:3 export yerleşimi.
 *
 * Masonry yok: hücreler 3 kolonluk satırlara dizilir, her satır aynı y'den
 * başlar ve satır yüksekliği o satırdaki en uzun hücredir (editördeki CSS
 * grid ile aynı). Hücre genişliği, en kötü durumda (her satırda Reel) bile
 * 3 satır header/footer bantları arasına sığacak şekilde seçilir; böylece
 * sayfa başına hücre sayısı (9) ve sayfa sayısı içerikten bağımsız kalır.
 */
export function calculateExportLayout(cells: GridResult["cells"]): ExportLayout {
  const usableHeight = GRID_BOTTOM - GRID_TOP;
  const fullWidthCell = (A4_W - GRID_LEADING * (GRID_COLUMNS - 1)) / GRID_COLUMNS;
  const fittingCell =
    (usableHeight - GRID_LEADING * (EXPORT_ROWS_PER_PAGE - 1)) /
    (EXPORT_ROWS_PER_PAGE * MAX_CELL_HEIGHT_RATIO);
  // 0.01 pt'ye aşağı yuvarlama: kayan nokta hatası 3. satırı taşırmasın.
  const cellWidth = Math.floor(Math.min(fullWidthCell, fittingCell) * 100) / 100;
  const gridWidth = cellWidth * GRID_COLUMNS + GRID_LEADING * (GRID_COLUMNS - 1);
  const pagination = calculatePagination(
    cells,
    cellWidth * MAX_CELL_HEIGHT_RATIO,
    GRID_TOP,
    GRID_BOTTOM,
  );
  return { cellWidth, offsetX: (A4_W - gridWidth) / 2, ...pagination };
}

export interface ExportCellRect {
  x: number;
  y: number;
  width: number;
  height: number;
  reel: boolean;
}

/**
 * Bir sayfanın hücre dikdörtgenleri (A4 pt). Hücre yüksekliği post tipine
 * göre (grid-ratio), satır başlangıcı satırdaki en uzun hücreye göre.
 */
export function calculateExportCellRects(
  pageCells: GridResult["cells"],
  layout: Pick<ExportLayout, "cellWidth" | "offsetX">,
): ExportCellRect[] {
  const rowHeights: number[] = [];
  pageCells.forEach((cell, i) => {
    const row = Math.floor(i / GRID_COLUMNS);
    const height = layout.cellWidth * gridCellHeightRatio(cell.post.postType);
    rowHeights[row] = Math.max(rowHeights[row] ?? 0, height);
  });
  const rowTops: number[] = [];
  let top = GRID_TOP;
  for (const height of rowHeights) {
    rowTops.push(top);
    top += height + GRID_LEADING;
  }
  return pageCells.map((cell, i) => ({
    x: layout.offsetX + cell.column * (layout.cellWidth + GRID_LEADING),
    y: rowTops[Math.floor(i / GRID_COLUMNS)],
    width: layout.cellWidth,
    height: layout.cellWidth * gridCellHeightRatio(cell.post.postType),
    reel: isReelCell(cell.post.postType),
  }));
}

/**
 * object-cover kırpma: kaynak görselin merkezinden hedef oranında
 * (dstW × dstH) en büyük dikdörtgen alınır. Editördeki `object-cover` ile
 * aynı sonuç.
 */
export function calculateCoverCrop(
  image: HTMLImageElement,
  dstW: number,
  dstH: number,
): { srcX: number; srcY: number; srcW: number; srcH: number } {
  const w = image.naturalWidth || image.width || 0;
  const h = image.naturalHeight || image.height || 0;
  if (w === 0 || h === 0 || dstW <= 0 || dstH <= 0) {
    return { srcX: 0, srcY: 0, srcW: 1, srcH: 1 };
  }
  const targetRatio = dstW / dstH;
  if (w / h > targetRatio) {
    // Kaynak daha geniş: yanlardan kırp.
    const srcW = h * targetRatio;
    return { srcX: (w - srcW) / 2, srcY: 0, srcW, srcH: h };
  }
  // Kaynak daha uzun: üstten/alttan kırp.
  const srcH = w / targetRatio;
  return { srcX: 0, srcY: (h - srcH) / 2, srcW: w, srcH };
}

/** Editördeki Reel rozeti: sağ üstte koyu daire içinde oynat üçgeni. */
function drawReelBadge(ctx: CanvasRenderingContext2D, rect: ExportCellRect): void {
  const radius = 9;
  const cx = rect.x + rect.width - 6 - radius;
  const cy = rect.y + 6 + radius;
  ctx.save();
  ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.moveTo(cx - 3, cy - 4.5);
  ctx.lineTo(cx + 4.5, cy);
  ctx.lineTo(cx - 3, cy + 4.5);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/**
 * Compute a 1:1 square crop rectangle taken from the image centre.
 * - sourceSize = min(naturalWidth, naturalHeight)
 * - center the source rectangle inside the source image
 * - destination is a full square cell (object-cover style)
 */
export function calculateSquareCrop(
  image: HTMLImageElement,
  cellSize: number,
): { srcX: number; srcY: number; srcW: number; srcH: number; dstX: number; dstY: number; dstW: number; dstH: number } {
  const w = image.naturalWidth || image.width || 0;
  const h = image.naturalHeight || image.height || 0;
  if (w === 0 || h === 0) {
    return {
      srcX: 0,
      srcY: 0,
      srcW: 1,
      srcH: 1,
      dstX: 0,
      dstY: 0,
      dstW: cellSize,
      dstH: cellSize,
    };
  }

  const sourceSize = Math.min(w, h);
  const srcX = (w - sourceSize) / 2;
  const srcY = (h - sourceSize) / 2;
  const srcW = sourceSize;
  const srcH = sourceSize;

  return {
    srcX,
    srcY,
    srcW,
    srcH,
    dstX: 0,
    dstY: 0,
    dstW: cellSize,
    dstH: cellSize,
  };
}

/** Render one export page onto a square pixel canvas, in UI order. */
export function renderExportPage(
  canvas: HTMLCanvasElement,
  page: number,
  images: HTMLImageElement[],
  pageCells: GridResult["cells"],
  brand: Brand,
  layout: Pick<ExportLayout, "cellWidth" | "offsetX" | "cellsPerPage">,
  totalPages: number,
  profileImage?: HTMLImageElement | null,
  /** Vertical offset in A4 points; lets the JPG builder stack pages. */
  topOffsetPt = 0,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas context is not available.");

  // Draw in A4 point coordinates; the canvas itself is EXPORT_SCALE larger.
  ctx.setTransform(
    EXPORT_SCALE,
    0,
    0,
    EXPORT_SCALE,
    0,
    topOffsetPt * EXPORT_SCALE,
  );

  // Start every page with a clean background.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, A4_W, A4_H);

  if (pageCells.length === 0) return;

  // Grid starts below the header band (avatar, brand, bio, date).
  // `pageCells` are this page's slice of the grid, in grid order, so the local
  // row and the matching image index both come from the position in the page.
  const imageOffset = page * layout.cellsPerPage;
  const rects = calculateExportCellRects(pageCells, layout);
  for (let i = 0; i < pageCells.length; i += 1) {
    const cell = pageCells[i];
    const rect = rects[i];
    const { x, y } = rect;

    // Cell background (Post 3:4, Reel 2:3).
    ctx.fillStyle = "#f8faf9";
    ctx.fillRect(x, y, rect.width, rect.height);

    const image = images[imageOffset + i];
    if (image) {
      // object-cover: kaynak merkezden hücre oranında kırpılır.
      const crop = calculateCoverCrop(image, rect.width, rect.height);
      ctx.drawImage(
        image,
        crop.srcX,
        crop.srcY,
        crop.srcW,
        crop.srcH,
        x,
        y,
        rect.width,
        rect.height,
      );
    }

    if (rect.reel) drawReelBadge(ctx, rect);

    // Pinned and planned markers.
    if (cell.pinned) {
      ctx.fillStyle = "#111827";
      ctx.font = "12px Inter, system-ui, sans-serif";
      ctx.fillText("📌", x + 6, y + 18);
    }
    if (cell.post.source === "planlanan") {
      ctx.fillStyle = "#111827";
      ctx.font = "10px Inter, system-ui, sans-serif";
      ctx.fillText("PLAN", x + 6, y + 14);
    }
  }

  // Header: small circular profile avatar, brand, username, bio, date.
  const profileSize = 72;
  ctx.save();
  ctx.beginPath();
  ctx.arc(profileSize / 2, profileSize / 2, profileSize / 2, 0, Math.PI * 2);
  ctx.clip();
  if (profileImage && profileImage.naturalWidth > 0) {
    const crop = calculateSquareCrop(profileImage, profileSize);
    ctx.drawImage(
      profileImage,
      crop.srcX,
      crop.srcY,
      crop.srcW,
      crop.srcH,
      0,
      0,
      profileSize,
      profileSize,
    );
  } else {
    ctx.fillStyle = "#e5e7eb";
    ctx.fillRect(0, 0, profileSize, profileSize);
  }
  ctx.restore();

  ctx.fillStyle = "#111827";
  ctx.font = "20px Inter, system-ui, sans-serif";
  ctx.fillText(brand.name, profileSize + 20, 30);

  ctx.fillStyle = "#6b7280";
  ctx.font = "14px Inter, system-ui, sans-serif";
  ctx.fillText(`@${brand.username}`, profileSize + 20, 56);

  if (brand.bio) {
    const maxChars = Math.max(10, Math.floor((A4_W - profileSize - 50) / 7.6));
    const lines = wrapText(brand.bio, maxChars);
    let lineY = 86;
    for (const line of lines) {
      ctx.fillStyle = "#555555";
      ctx.font = "14px Inter, system-ui, sans-serif";
      ctx.fillText(line, profileSize + 20, lineY);
      lineY += 18;
    }
  }

  // Creation date: brand id if it is a real timestamp, otherwise export date.
  const parsed = brand.id ? Date.parse(brand.id) : NaN;
  const created = new Date(Number.isNaN(parsed) ? Date.now() : parsed);
  ctx.fillStyle = "#9ca3af";
  ctx.font = "11px Inter, system-ui, sans-serif";
  ctx.fillText(
    created.toLocaleDateString("tr-TR", {
      year: "numeric",
      month: "short",
      day: "numeric",
    }),
    A4_W - 110,
    30,
  );

  // Footer: consistent page info.
  ctx.fillStyle = "#6b7280";
  ctx.font = "9px Inter, system-ui, sans-serif";
  ctx.fillText(
    `${EXPORT_BRANDING} · ${brand.name} · ${brand.username} · ${page + 1} / ${totalPages}`,
    8,
    A4_H - 6,
  );
}

/**
 * Decode a standard Base64 string into raw bytes.
 * Kept public so binary conversion is unit-testable without a canvas.
 */
export function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/** Convert a canvas to a real JPEG binary, without using `toDataURL`. */
export function canvasToJpegBytes(canvas: HTMLCanvasElement, quality = 0.92): Promise<Uint8Array<ArrayBuffer>> {
  return new Promise<Uint8Array<ArrayBuffer>>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("JPEG üretilemedi."));
          return;
        }
        const reader = new FileReader();
        reader.onloadend = () => {
          const data = reader.result;
          if (typeof data !== "string") {
            reject(new Error("JPEG binary could not be read."));
            return;
          }
          // `data` is a data URL; take the Base64 payload after the comma.
          resolve(base64ToBytes(data.slice(data.indexOf(",") + 1)));
        };
        reader.onerror = () => reject(new Error("JPEG binary could not be read."));
        reader.readAsDataURL(blob);
      },
      "image/jpeg",
      quality,
    );
  });
}

/** Convert a canvas to a real PNG binary. */
export function canvasToPngBytes(canvas: HTMLCanvasElement): Promise<Uint8Array<ArrayBuffer>> {
  return new Promise<Uint8Array<ArrayBuffer>>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("PNG üretilemedi."));
          return;
        }
        const reader = new FileReader();
        reader.onloadend = () => {
          const data = reader.result;
          if (typeof data !== "string") {
            reject(new Error("PNG binary could not be read."));
            return;
          }
          resolve(base64ToBytes(data.slice(data.indexOf(",") + 1)));
        };
        reader.onerror = () => reject(new Error("PNG binary could not be read."));
        reader.readAsDataURL(blob);
      },
      "image/png",
    );
  });
}

function wrapText(text: string, maxChars: number): string[] {
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

export async function buildExportData(
  brand: Brand,
  result: GridResult,
  imageUrls: Promise<string>[],
): Promise<{ brand: Brand; result: GridResult; images: HTMLImageElement[] }> {
  // `imageUrls` are promises (UI passes `Promise.resolve(url)`), resolve first.
  const urls = await Promise.all(imageUrls);
  const images = await Promise.all(urls.map((url) => loadImageAsElement(url)));
  return { brand, result, images };
}

/**
 * Build a real A4 PDF, with one PDFPage per export page.
 * Each page is rendered on canvas, captured as PNG bytes, then embedded into
 * pdf-lib as a full-page image. The final file starts with `%PDF-`.
 */
export async function buildPdfBytes(
  brand: Brand,
  result: GridResult,
  imageElements: HTMLImageElement[],
): Promise<Uint8Array<ArrayBuffer>> {
  const { cells } = result;
  const layout = calculateExportLayout(cells);
  const { cellsPerPage, pageCount } = layout;

  // Profile avatar is loaded once, before rendering, so it is drawn on every
  // page (an async `Image.src` set inside the sync renderer would not be ready).
  const profileImage = brand.profileImageUrl
    ? await loadImageAsElement(brand.profileImageUrl).catch(() => null)
    : null;

  const pdfDoc = await PDFDocument.create();

  // Each export page is rendered on canvas, captured as PNG and embedded into
  // a real A4 PDF page.
  const pageCanvas = document.createElement("canvas");
  pageCanvas.width = Math.round(A4_W * EXPORT_SCALE);
  pageCanvas.height = Math.round(A4_H * EXPORT_SCALE);

  for (let page = 0; page < pageCount; page += 1) {
    const startIndex = page * cellsPerPage;
    const endIndex = Math.min(cells.length, startIndex + cellsPerPage);
    const pageCells = cells.slice(startIndex, endIndex);

    renderExportPage(
      pageCanvas,
      page,
      imageElements,
      pageCells,
      brand,
      layout,
      pageCount,
      profileImage,
    );

    const pngBytes = await canvasToPngBytes(pageCanvas);
    const base64 = Uint8ArrayToBase64(pngBytes);
    const img = await pdfDoc.embedPng(base64);

    const pdfPage = pdfDoc.addPage([A4_W, A4_H]);

    // Cover the whole A4 page with the rendered page image.
    pdfPage.drawImage(img, {
      x: 0,
      y: 0,
      width: A4_W,
      height: A4_H,
    });
  }

  const saved = await pdfDoc.save();
  return new Uint8Array(saved);
}

/**
 * Build a real JPEG from the same export render surface.
 * No `toDataURL("image/jpeg")` string is inserted into the Blob.
 */
export async function buildJpgBytes(
  brand: Brand,
  result: GridResult,
  imageElements: HTMLImageElement[],
): Promise<Uint8Array<ArrayBuffer>> {
  const { cells } = result;
  const layout = calculateExportLayout(cells);
  const { cellsPerPage, pageCount } = layout;

  const profileImage = brand.profileImageUrl
    ? await loadImageAsElement(brand.profileImageUrl).catch(() => null)
    : null;

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(A4_W * EXPORT_SCALE);
  // All export pages are stacked vertically so the JPG shows the same grid
  // content as the PDF.
  canvas.height = Math.round(A4_H * EXPORT_SCALE * pageCount);

  for (let page = 0; page < pageCount; page += 1) {
    const startIndex = page * cellsPerPage;
    const endIndex = Math.min(cells.length, startIndex + cellsPerPage);
    const pageCells = cells.slice(startIndex, endIndex);

    renderExportPage(
      canvas,
      page,
      imageElements,
      pageCells,
      brand,
      layout,
      pageCount,
      profileImage,
      page * A4_H,
    );
  }

  return canvasToJpegBytes(canvas, 0.92);
}

function Uint8ArrayToBase64(bytes: Uint8Array<ArrayBuffer>): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
