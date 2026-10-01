"use client";

import { ArrowPathIcon } from "@heroicons/react/16/solid";

import { STORAGE_VERSION } from "@/lib/storage";

/**
 * Ayarlar sayfası: yerel depolama bilgisi ve “demo verilere dön” tehlikeli alanı.
 * Sıfırlama davranışı değişmedi: localStorage + IndexedDB temizlenir.
 */
export default function SettingsPage({
  projectCount,
  onReset,
}: {
  projectCount: number;
  onReset: () => void;
}) {
  return (
    <div className="mx-auto max-w-[760px]">
      <p className="mb-6 text-sm text-neutral-500">
        Uygulama verileri yalnızca bu tarayıcıda saklanır; sunucuya marka verisi gönderilmez.
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
          Tüm yerel veriler (projeler ve yüklenen görseller) silinir ve demo verilere
          dönülür. Sunucudaki paylaşım bağlantıları etkilenmez.
        </p>
        <button
          type="button"
          onClick={onReset}
          className="mt-3 inline-flex h-9 items-center gap-2 rounded-lg px-2 text-sm font-medium text-red-700 hover:bg-red-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600"
        >
          <ArrowPathIcon className="size-4" aria-hidden="true" />
          Demo verilere dön
        </button>
      </div>
    </div>
  );
}
