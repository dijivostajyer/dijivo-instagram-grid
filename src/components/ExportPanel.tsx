"use client";

import { useCallback, useRef, useState } from "react";

import { ArrowDownTrayIcon, DocumentTextIcon } from "@heroicons/react/24/outline";
import type { Brand, GridResult } from "@/lib/types";
import {
  buildExportData,
  buildFileName,
  buildJpgBytes,
  buildPdfBytes,
  slugify,
} from "@/lib/export";

/** Exportnu başlattığımızda kullanıcıya kısa bir yükleniyor durumu gösterir. */
export interface ExportStep {
  key: string;
  fileName: string;
  loading: boolean;
  error?: string;
  done: boolean;
}

/** Export butonu: PDF ve JPG. */
export interface ExportPanelProps {
  brand: Brand;
  result: GridResult;
  imageUrls: Promise<string>[];
  options: ExportOptions;
}

/**
 * ExportPanel: PDF ve JPG indirme alanı.
 * - Sadece İndir butonları ve yükleniyor durumu; uygulama diğer alanları
 *   (form, sürükleme tutamaçları, silme/pinlet butonları) bozmaz.
 */
export default function ExportPanel({
  brand,
  result,
  imageUrls,
  options,
}: ExportPanelProps) {
  const { download, showError } = options;
  const [steps, setSteps] = useState<ExportStep[]>([
    {
      key: "pdf",
      fileName: buildFileName(brand, "pdf"),
      loading: false,
      error: undefined,
      done: false,
    },
    {
      key: "jpg",
      fileName: buildFileName(brand, "jpg"),
      loading: false,
      error: undefined,
      done: false,
    },
  ]);
  const busyRef = useRef(false);

  const startExport = useCallback(
    async (suffix: "pdf" | "jpg") => {
      if (busyRef.current) return;
      busyRef.current = true;

      const step = steps.find((s) => s.key === suffix);
      if (!step) return;

      setSteps((prev) =>
        prev.map((s) =>
          s.key === suffix
            ? { ...s, loading: true, error: undefined, done: false }
            : s,
        ),
      );

      try {
        // Export sırasında görseller yüklenir; boş PDF/JPG üretilmemeli.
        const data = await buildExportData(brand, result, imageUrls);
        const bytes =
          suffix === "pdf"
            ? await buildPdfBytes(brand, data.result, data.images)
            : await buildJpgBytes(brand, data.result, data.images);

        if (!bytes || bytes.length === 0) {
          throw new Error("Dışaktarım dosyası oluşturulamadı.");
        }

        const blob = new Blob([bytes], {
          type: suffix === "pdf" ? "application/pdf" : "image/jpeg",
        });

        const fileName = buildFileName(brand, suffix);
        await download(fileName, blob);

        setSteps((prev) =>
          prev.map((s) =>
            s.key === suffix ? { ...s, loading: false, done: true } : s,
          ),
        );
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Dışa aktarım başarısız oldu.";
        setSteps((prev) =>
          prev.map((s) =>
            s.key === suffix
              ? { ...s, loading: false, error: message, done: false }
              : s,
          ),
        );
        showError(message);
      } finally {
        busyRef.current = false;
      }
    },
    [brand, result, imageUrls, download, showError, steps],
  );

  const canExport =
    steps.every((s) => !s.loading) && busyRef.current === false;

  return (
    <section className="rounded-lg border border-neutral-200 p-4">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
        <DocumentTextIcon className="h-4 w-4 text-neutral-500" />
        İndir
      </h2>

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => void startExport("pdf")}
          disabled={!canExport}
          className="inline-flex items-center gap-2 rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <DocumentTextIcon className="h-4 w-4" />
          PDF İndir
        </button>
        <button
          type="button"
          onClick={() => void startExport("jpg")}
          disabled={!canExport}
          className="inline-flex items-center gap-2 rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <ArrowDownTrayIcon className="h-4 w-4" />
          JPG İndir
        </button>
      </div>

      {steps.some((s) => s.error) ? (
        <p role="alert" className="mt-3 text-xs font-medium text-red-600">
          {steps.find((s) => s.error)?.error}
        </p>
      ) : null}
      {steps.every((s) => s.done) ? (
        <p className="mt-3 text-xs text-green-700">Dosyalar indirildi.</p>
      ) : null}
    </section>
  );
}

export interface ExportOptions {
  setExporting?: (exporting: boolean) => void;
  isExporting?: (key: string) => boolean;
  download: (fileName: string, blob: Blob) => Promise<void>;
  showError: (message: string) => void;
}
