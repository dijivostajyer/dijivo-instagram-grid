"use client";

import ExportPanel, { type ExportOptions } from "@/components/ExportPanel";
import {
  A4_W,
  GRID_BOTTOM,
  GRID_LEADING,
  GRID_TOP,
  calculatePagination,
} from "@/lib/export";
import { GRID_COLUMNS } from "@/lib/grid";
import type { Brand, GridResult } from "@/lib/types";

/**
 * Müşteri sunumu dışa aktarma sayfası: PDF/JPG indirme ve çıktı bilgileri
 * (A4, 300 DPI, sayfa sayısı, aktif proje). Export pipeline'ına dokunulmaz.
 */
export default function ExportWorkspace({
  brand,
  result,
  imageUrls,
  options,
  projectLabel,
}: {
  brand: Brand;
  result: GridResult;
  imageUrls: Promise<string>[];
  options: ExportOptions;
  projectLabel: string;
}) {
  const cellSize = (A4_W - GRID_LEADING * (GRID_COLUMNS - 1)) / GRID_COLUMNS;
  const { pageCount, cellsPerPage } = calculatePagination(
    result.cells,
    cellSize,
    GRID_TOP,
    GRID_BOTTOM,
  );

  const rows: Array<{ label: string; value: string }> = [
    { label: "Biçim", value: "A4 dikey (210 × 297 mm)" },
    { label: "Çözünürlük", value: "300 DPI · 2480 × 3508 px / sayfa" },
    { label: "Sayfa", value: `${pageCount} sayfa · ${cellsPerPage} hücre/sayfa` },
    { label: "Grid", value: `${result.cells.length} gönderi · ${result.pinnedCount} pinned` },
    { label: "Aktif proje", value: projectLabel },
    { label: "Dosyalar", value: `PDF + JPG · ${brand.name || "marka"}` },
  ];

  return (
    <div className="mx-auto max-w-[760px]">
      <p className="mb-6 text-sm text-neutral-500">
        Grid görünümünü Dijivo şablonunda A4 PDF ve JPG olarak indirin. Çıktı, ekranda
        gördüğünüz grid ile birebir aynıdır.
      </p>

      <div className="rounded-xl border border-slate-200 bg-white p-5 sm:p-6">
        <h3 className="mb-4 text-sm font-semibold text-neutral-900">Çıktı bilgileri</h3>
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          {rows.map((row) => (
            <div key={row.label} className="flex justify-between gap-3 border-b border-slate-100 pb-2">
              <dt className="text-neutral-500">{row.label}</dt>
              <dd className="text-right font-medium text-neutral-800">{row.value}</dd>
            </div>
          ))}
        </dl>

        <div className="mt-6">
          <ExportPanel brand={brand} result={result} imageUrls={imageUrls} options={options} />
        </div>
      </div>
    </div>
  );
}
