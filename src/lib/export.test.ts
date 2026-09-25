import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";

import {
  A4_H,
  A4_W,
  base64ToBytes,
  calculatePagination,
  calculateSquareCrop,
  buildFileName,
  GRID_BOTTOM,
  GRID_LEADING,
  GRID_TOP,
  normalizeColor,
  slugify,
} from "./export";
import type { ExistingPost, PlannedPost, GridCell } from "./types";

function existing(overrides: Partial<ExistingPost> = {}): ExistingPost {
  return {
    id: "e1",
    source: "mevcut",
    imageUrl: "https://example.com/e1.jpg",
    recencyIndex: 0,
    pinned: false,
    ...overrides,
  };
}

function planned(overrides: Partial<PlannedPost> = {}): PlannedPost {
  return {
    id: "p1",
    source: "planlanan",
    imageUrl: "https://example.com/p1.jpg",
    planOrder: 0,
    ...overrides,
  };
}

describe("slugify", () => {
  it("lowercases and replaces Turkish characters with ASCII", () => {
    expect(slugify("Marka Adı")).toBe("marka-adi");
    expect(slugify("Dijivo İnstagram")).toBe("dijivo-instagram");
  });

  it("handles mixed uppercase and special characters", () => {
    expect(slugify("  Dijivo  İnstagram  ")).toBe("dijivo-instagram");
    expect(slugify("Marka Adi!")).toBe("marka-adi");
    expect(slugify("  ")).toBe("instagram-grid");
    expect(slugify("")).toBe("instagram-grid");
  });
});

describe("buildFileName", () => {
  it("builds a brand name + suffix file name", () => {
    const brand = { id: "x", name: "Dijivo Demo Marka", username: "dijivo" } as const;
    expect(buildFileName(brand, "pdf")).toBe("dijivo-demo-marka.pdf");
    expect(buildFileName(brand, "jpg")).toBe("dijivo-demo-marka.jpg");
  });
});

describe("normalizeColor", () => {
  it("normalizes hex, name, and rgb shapes", () => {
    expect(normalizeColor("#ffffff")).toBe("#ffffff");
    expect(normalizeColor("#f3f4f6")).toBe("#f3f4f6");
    expect(normalizeColor("red")).toBe("red");
    expect(normalizeColor("rgb(17,24,39)")).toBe("#111827");
    expect(normalizeColor("invalid-color")).toBe("invalid-color");
    expect(normalizeColor("#zz")).toBe("#ffffff");
  });
});

describe("calculatePagination", () => {
  const cells: GridCell[] = [
    { position: 0, column: 0, row: 0, pinned: false, post: existing() },
    { position: 1, column: 1, row: 0, pinned: false, post: existing() },
    { position: 2, column: 2, row: 0, pinned: false, post: existing() },
    { position: 3, column: 0, row: 1, pinned: false, post: existing() },
  ];

  it("returns one page for an empty grid", () => {
    const result = calculatePagination([], 200, 400, 800);
    expect(result.rowsPerPage).toBe(1);
    expect(result.cellsPerPage).toBe(3);
    expect(result.pageCount).toBe(1);
  });

  it("computes per-page cells from rowsPerPage and columns", () => {
    const result = calculatePagination(cells, 200, 400, 800);
    expect(result.cellsPerPage).toBe(3);
    expect(result.pageCount).toBe(2);
  });

  it("never overflows the page", () => {
    const result = calculatePagination(cells, 200, 400, 800);
    expect(result.rowsPerPage).toBeGreaterThan(0);
    expect(result.cellsPerPage).toBe(result.rowsPerPage * 3);
  });
});

/** Real A4 geometry used by `buildPdfBytes` / `buildJpgBytes`. */
describe("calculatePagination on real A4 geometry", () => {
  const cellSize = (A4_W - GRID_LEADING * (3 - 1)) / 3;

  function cellsOf(count: number): GridCell[] {
    return Array.from({ length: count }, (_, i) => ({
      position: i,
      column: i % 3,
      row: Math.floor(i / 3),
      pinned: false,
      post: existing({ id: `e${i}` }),
    }));
  }

  it("fits exactly 3 rows (9 cells) per A4 page", () => {
    const result = calculatePagination(cellsOf(9), cellSize, GRID_TOP, GRID_BOTTOM);
    expect(result.rowsPerPage).toBe(3);
    expect(result.cellsPerPage).toBe(9);
  });

  it("computes real page counts for 0/1/2/3/8/9/10+ content", () => {
    const pageCountOf = (count: number) =>
      calculatePagination(cellsOf(count), cellSize, GRID_TOP, GRID_BOTTOM).pageCount;

    expect(pageCountOf(0)).toBe(1);
    expect(pageCountOf(1)).toBe(1);
    expect(pageCountOf(2)).toBe(1);
    expect(pageCountOf(3)).toBe(1);
    expect(pageCountOf(8)).toBe(1);
    expect(pageCountOf(9)).toBe(1);
    expect(pageCountOf(10)).toBe(2);
    expect(pageCountOf(18)).toBe(2);
    expect(pageCountOf(19)).toBe(3);
  });

  it("keeps the grid inside the header/footer bands", () => {
    const { rowsPerPage } = calculatePagination(cellsOf(30), cellSize, GRID_TOP, GRID_BOTTOM);
    const gridHeight = rowsPerPage * cellSize + (rowsPerPage - 1) * GRID_LEADING;
    expect(GRID_TOP + gridHeight).toBeLessThanOrEqual(GRID_BOTTOM);
    expect(GRID_BOTTOM).toBeLessThan(A4_H);
  });
});

describe("binary signatures", () => {
  it("pdf-lib save() output starts with %PDF-", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([A4_W, A4_H]);
    const bytes = await doc.save();
    const head = String.fromCharCode(...bytes.slice(0, 5));
    expect(head).toBe("%PDF-");
  });

  it("base64 JPEG binary decodes to FF D8 FF magic bytes", () => {
    let raw = "";
    for (const byte of [0xff, 0xd8, 0xff, 0xe0]) {
      raw += String.fromCharCode(byte);
    }
    const bytes = base64ToBytes(btoa(raw));
    expect(Array.from(bytes.slice(0, 3))).toEqual([0xff, 0xd8, 0xff]);
    expect(bytes.length).toBe(4);
  });
});

describe("calculateSquareCrop", () => {
  it("crops a landscape image from the centre for a square cell", () => {
    const image = {
      naturalWidth: 1200,
      naturalHeight: 800,
      width: 1200,
      height: 800,
    } as unknown as HTMLImageElement;

    const crop = calculateSquareCrop(image, 200);
    expect(crop.srcX).toBe(200);
    expect(crop.srcY).toBe(0);
    expect(crop.srcW).toBe(800);
    expect(crop.srcH).toBe(800);
    expect(crop.dstX).toBe(0);
    expect(crop.dstY).toBe(0);
    expect(crop.dstW).toBe(200);
    expect(crop.dstH).toBe(200);
  });

  it("crops a portrait image from the centre for a square cell", () => {
    const image = {
      naturalWidth: 800,
      naturalHeight: 1200,
      width: 800,
      height: 1200,
    } as unknown as HTMLImageElement;

    const crop = calculateSquareCrop(image, 200);
    expect(crop.srcX).toBe(0);
    expect(crop.srcY).toBe(200);
    expect(crop.srcW).toBe(800);
    expect(crop.srcH).toBe(800);
    expect(crop.dstW).toBe(200);
    expect(crop.dstH).toBe(200);
  });

  it("handles a square image without cropping horizontally or vertically", () => {
    const image = {
      naturalWidth: 1000,
      naturalHeight: 1000,
      width: 1000,
      height: 1000,
    } as unknown as HTMLImageElement;

    const crop = calculateSquareCrop(image, 200);
    expect(crop.srcX).toBe(0);
    expect(crop.srcY).toBe(0);
    expect(crop.srcW).toBe(1000);
    expect(crop.srcH).toBe(1000);
    expect(crop.dstW).toBe(200);
    expect(crop.dstH).toBe(200);
  });
});

