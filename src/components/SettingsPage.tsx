"use client";

import { useState } from "react";
import { ExclamationTriangleIcon } from "@heroicons/react/16/solid";

import { STORAGE_VERSION } from "@/lib/storage";

/**
 * Ayarlar sayfası: yerel depolama bilgisi ve "tüm verileri temizle" tehlikeli alanı.
 * Sıfırlama davranışı: localStorage + IndexedDB + sunucu workspace verileri temizlenir.
 */
export default function SettingsPage({
  projectCount,
  onReset,
}: {
  projectCount: number;
  onReset: () => Promise<void>;
}) {
  const [showConfirm, setShowConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const handleConfirmDelete = async () => {
    setIsDeleting(true);
    setDeleteError(null);
    try {
      await onReset();
      setShowConfirm(false);
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "Veriler temizlenemedi. Lütfen tekrar deneyin.");
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="mx-auto max-w-[760px]">
      <p className="mb-6 text-sm text-neutral-500">
        Uygulama verileri sunucuda ve tarayıcıda saklanır.
      </p>

      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <h3 className="text-sm font-semibold text-neutral-900">Yerel veriler</h3>
        <dl className="mt-3 space-y-2 text-sm">
          <div className="flex justify-between gap-3 border-b border-slate-100 pb-2">
            <dt className="text-neutral-500">Depolama</dt>
            <dd className="font-medium text-neutral-800">localStorage metaveri + IndexedDB görseller</dd>
          </div>
          <div className="flex justify-between gap-3 border-b border-slate-100 pb-2">
            <dt className="text-neutral-500">Şema sürümü</dt>
            <dd className="font-medium text-neutral-800">v{STORAGE_VERSION}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-neutral-500">Aylık proje</dt>
            <dd className="font-medium text-neutral-800">{projectCount}</dd>
          </div>
        </dl>
      </div>

      <div className="mt-6 rounded-xl border border-red-200 bg-white p-5">
        <p className="text-sm font-semibold text-neutral-900">Tehlikeli alan</p>
        <p className="mt-1 text-sm text-neutral-500">
          Tüm çalışma alanı verileri, gönderiler, markalar, takvim kayıtları, medya ve paylaşım kayıtları kalıcı olarak silinecek. Bu işlem geri alınamaz.
        </p>
        <button
          type="button"
          onClick={() => { setDeleteError(null); setShowConfirm(true); }}
          disabled={isDeleting}
          className="mt-3 inline-flex h-9 items-center gap-2 rounded-lg bg-red-600 px-3 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600"
        >
          <ExclamationTriangleIcon className="size-4" aria-hidden="true" />
          Tüm Verileri Temizle
        </button>
      </div>

      {showConfirm && (
        <div
          className="fixed inset-0 z-50 grid place-items-center overflow-y-auto p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Tüm verileri temizle"
        >
          <div
            className="fixed inset-0 bg-black/40"
            onClick={() => setShowConfirm(false)}
            aria-hidden="true"
          />
          <div className="relative w-full max-w-md rounded-2xl bg-white shadow-2xl">
            <div className="p-6">
              <div className="flex items-start gap-4">
                <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-red-100">
                  <ExclamationTriangleIcon className="size-6 text-red-600" aria-hidden="true" />
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="text-lg font-semibold text-neutral-900">
                    Tüm Verileri Temizle
                  </h2>
                  <p className="mt-2 text-sm text-neutral-600">
                    Tüm çalışma alanı verileri, gönderiler, markalar, takvim kayıtları, medya ve paylaşım kayıtları kalıcı olarak silinecek. Bu işlem geri alınamaz. Devam etmek istiyor musunuz?
                  </p>
                </div>
              </div>
              <div className="mt-6 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowConfirm(false)}
                  disabled={isDeleting}
                  className="inline-flex h-9 items-center rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
                >
                  İptal
                </button>
                <button
                  type="button"
                  onClick={handleConfirmDelete}
                  disabled={isDeleting}
                  className="inline-flex h-9 items-center rounded-lg bg-red-600 px-3 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600"
                >
                  {isDeleting ? "Siliniyor..." : "Tüm Verileri Sil"}
                </button>
              </div>
              {deleteError ? <p role="alert" className="mt-3 text-sm font-medium text-red-700">{deleteError}</p> : null}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
