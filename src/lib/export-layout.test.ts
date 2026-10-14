// @vitest-environment jsdom
import { PDFDocument } from "pdf-lib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  A4_H,
  A4_W,
  buildJpgBytes,
  buildPdfBytes,
  calculateCoverCrop,
  calculateExportCellRects,
  calculateExportLayout,
  EXPORT_SCALE,
  GRID_BOTTOM,
  GRID_LEADING,
  GRID_TOP,
  renderExportPage,
} from "./export";
import type { GridCell, PostType } from "./types";

function cell(i: number, postType: PostType = "post", source: "mevcut" | "planlanan" = "mevcut"): GridCell {
  return {
    position: i,
    column: i % 3,
    row: Math.floor(i / 3),
    pinned: false,
    post: source === "mevcut"
      ? { id: `c${i}`, source, imageUrl: `https://cdn.test/${i}.jpg`, recencyIndex: i, pinned: false, postType }
      : { id: `c${i}`, source, imageUrl: `https://cdn.test/${i}.jpg`, planOrder: i, postType },
  };
}
const cellsOf = (types: PostType[]) => types.map((type, i) => cell(i, type));
const image = (w: number, h: number) => ({ naturalWidth: w, naturalHeight: h, width: w, height: h }) as unknown as HTMLImageElement;
const brand = { id: "brand-a", name: "Dijivo Demo", username: "dijivo", bio: "Bio" };

describe("calculateExportLayout", () => {
  it("sayfa başına 3 satır × 3 kolon (9 hücre) korunur", () => {
    const layout = calculateExportLayout(cellsOf(Array(9).fill("post")));
    expect(layout.rowsPerPage).toBe(3);
    expect(layout.cellsPerPage).toBe(9);
  });

  it("sayfa sayıları önceki kare yerleşimle aynıdır", () => {
    const pages = (count: number) => calculateExportLayout(cellsOf(Array(count).fill("post"))).pageCount;
    expect([0, 1, 3, 8, 9, 10, 18, 19].map(pages)).toEqual([1, 1, 1, 1, 1, 2, 2, 3]);
  });

  it("grid A4 genişliğinde ortalanır", () => {
    const layout = calculateExportLayout([]);
    const gridWidth = layout.cellWidth * 3 + GRID_LEADING * 2;
    expect(layout.offsetX).toBeGreaterThan(0);
    expect(layout.offsetX * 2 + gridWidth).toBeCloseTo(A4_W, 5);
  });

  it("en kötü durumda (tüm hücreler Reel) bile 3 satır header/footer arasına sığar", () => {
    const cells = cellsOf(Array(9).fill("reel"));
    const rects = calculateExportCellRects(cells, calculateExportLayout(cells));
    const bottom = Math.max(...rects.map((rect) => rect.y + rect.height));
    expect(rects[0].y).toBe(GRID_TOP);
    expect(bottom).toBeLessThanOrEqual(GRID_BOTTOM);
  });
});

describe("calculateExportCellRects", () => {
  it("Post 3:4, Reel 2:3", () => {
    const cells = cellsOf(["post", "reel", "carousel"]);
    const rects = calculateExportCellRects(cells, calculateExportLayout(cells));
    expect(rects[0].height / rects[0].width).toBeCloseTo(4 / 3, 10);
    expect(rects[1].height / rects[1].width).toBeCloseTo(3 / 2, 10);
    expect(rects[2].height / rects[2].width).toBeCloseTo(4 / 3, 10);
    expect(rects.map((rect) => rect.reel)).toEqual([false, true, false]);
  });

  it("satırlar hizalı: aynı satır aynı y'den başlar, sonraki satır en uzun hücreden sonra gelir", () => {
    const cells = cellsOf(["post", "reel", "post", "post", "post", "post"]);
    const layout = calculateExportLayout(cells);
    const rects = calculateExportCellRects(cells, layout);
    expect(new Set(rects.slice(0, 3).map((rect) => rect.y))).toEqual(new Set([GRID_TOP]));
    const reelRowHeight = layout.cellWidth * 1.5;
    expect(rects[3].y).toBeCloseTo(GRID_TOP + reelRowHeight + GRID_LEADING, 10);
    expect(new Set(rects.slice(3).map((rect) => rect.y)).size).toBe(1);
    // Kolon x'leri her satırda aynı (masonry yok).
    expect(rects.slice(3).map((rect) => rect.x)).toEqual(rects.slice(0, 3).map((rect) => rect.x));
  });
});

describe("calculateCoverCrop", () => {
  it("yatay görsel 3:4 hücreye yanlardan merkezden kırpılır", () => {
    const crop = calculateCoverCrop(image(1200, 800), 300, 400);
    expect(crop.srcH).toBe(800);
    expect(crop.srcW).toBeCloseTo(600, 10);
    expect(crop.srcX).toBeCloseTo(300, 10);
    expect(crop.srcY).toBe(0);
  });

  it("uzun görsel 2:3 hücreye üstten/alttan merkezden kırpılır", () => {
    const crop = calculateCoverCrop(image(1000, 2000), 200, 300);
    expect(crop.srcW).toBe(1000);
    expect(crop.srcH).toBeCloseTo(1500, 10);
    expect(crop.srcY).toBeCloseTo(250, 10);
  });
});

// --- Canvas render: jsdom'da canvas yok; çağrıları kaydeden sahte context ---
type Call = { name: string; args: unknown[] };
let calls: Call[];
let blobTypes: string[];
const PNG_1X1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

beforeEach(() => {
  calls = [];
  blobTypes = [];
  const ctx = new Proxy({} as Record<string, unknown>, {
    get(target, prop: string) {
      if (prop in target) return target[prop];
      return (...args: unknown[]) => { calls.push({ name: prop, args }); };
    },
    set(target, prop: string, value) { target[prop] = value; return true; },
  });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => ctx as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (callback: BlobCallback, type?: string) {
    blobTypes.push(type ?? "image/png");
    const bytes = type === "image/jpeg" ? new Uint8Array([0xff, 0xd8, 0xff, 0xe0]) : Uint8Array.from(atob(PNG_1X1), (c) => c.charCodeAt(0));
    callback(new Blob([bytes], { type: type ?? "image/png" }));
  });
});
afterEach(() => vi.restoreAllMocks());

describe("renderExportPage", () => {
  it("Post ve Reel medyası kendi oranında çizilir; Reel rozeti yalnız Reel'de", () => {
    const cells = [cell(0, "post"), cell(1, "reel"), cell(2, "post", "planlanan")];
    const layout = calculateExportLayout(cells);
    const canvas = document.createElement("canvas");
    renderExportPage(canvas, 0, [image(1080, 1080), image(1080, 1920), image(1080, 1350)], cells, brand, layout, 1, null);

    const media = calls.filter((call) => call.name === "drawImage" && call.args.length === 9);
    expect(media).toHaveLength(3);
    const ratios = media.map((call) => (call.args[8] as number) / (call.args[7] as number));
    expect(ratios[0]).toBeCloseTo(4 / 3, 10);
    expect(ratios[1]).toBeCloseTo(3 / 2, 10);
    expect(ratios[2]).toBeCloseTo(4 / 3, 10);

    // Rozet: Reel hücresinin sağ üst köşesinde tek daire (avatar daire'si hariç).
    const reelRect = calculateExportCellRects(cells, layout)[1];
    const badgeArcs = calls.filter((call) => call.name === "arc" && (call.args[0] as number) > reelRect.x && (call.args[0] as number) < reelRect.x + reelRect.width && (call.args[1] as number) < reelRect.y + 30);
    expect(badgeArcs).toHaveLength(1);
    const allArcs = calls.filter((call) => call.name === "arc");
    expect(allArcs).toHaveLength(2); // avatar + 1 Reel rozeti

    const texts = calls.filter((call) => call.name === "fillText").map((call) => call.args[0]);
    expect(texts).toContain("PLAN");
    expect(texts).toContain("Dijivo Demo");
    expect(texts).toContain("@dijivo");
  });
});

describe("PDF / JPG üretimi", () => {
  const mixed = Array.from({ length: 10 }, (_, i) => cell(i, i % 4 === 1 ? "reel" : "post"));
  const images = mixed.map(() => image(1080, 1350));

  it("PDF: gerçek A4 sayfaları, 10 hücre → 2 sayfa", async () => {
    const bytes = await buildPdfBytes(brand, { cells: mixed, pinnedCount: 0 } as never, images);
    expect(String.fromCharCode(...bytes.slice(0, 5))).toBe("%PDF-");
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(2);
    const { width, height } = doc.getPage(0).getSize();
    expect(width).toBeCloseTo(A4_W, 2);
    expect(height).toBeCloseTo(A4_H, 2);
  });

  it("JPG: sayfalar alt alta, 300 DPI, JPEG binary", async () => {
    const createElement = document.createElement.bind(document);
    let canvas: HTMLCanvasElement | null = null;
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const element = createElement(tag);
      if (tag === "canvas") canvas = element as HTMLCanvasElement;
      return element;
    });
    const bytes = await buildJpgBytes(brand, { cells: mixed, pinnedCount: 0 } as never, images);
    expect(Array.from(bytes.slice(0, 3))).toEqual([0xff, 0xd8, 0xff]);
    expect(blobTypes).toEqual(["image/jpeg"]);
    expect(canvas!.width).toBe(Math.round(A4_W * EXPORT_SCALE));
    expect(canvas!.height).toBe(Math.round(A4_H * EXPORT_SCALE * 2));
  });
});
