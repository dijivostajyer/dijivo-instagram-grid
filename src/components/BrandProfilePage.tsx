"use client";

import { useState } from "react";

import BrandEditor from "@/components/BrandEditor";
import type { Brand } from "@/lib/types";

/**
 * Marka profili yönetim sayfası. Eski drawer yerine sidebar'dan erişilen
 * tam sayfadır; alanlar ve otomatik kaydetme davranışı değişmemiştir.
 */
export default function BrandProfilePage({
  brand,
  onChange,
  brands,
  onCopyHighlight,
  onDelete,
}: {
  brand: Brand;
  onChange: (next: Brand) => void;
  /** §17: öne çıkan kopyalamak için marka kayıt defteri. */
  brands: Brand[];
  onCopyHighlight: (highlightId: string, targetBrandId: string) => string | null;
  onDelete: () => Promise<void>;
}) {
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="mx-auto max-w-[760px]">
      <p className="mb-6 text-sm text-neutral-500">
        Profil fotoğrafı, marka bilgileri, içerik ayarları, hashtag grupları,
        istatistikler ve öne çıkanlar. Değişiklikler otomatik olarak
        tarayıcınıza kaydedilir.
      </p>
      <BrandEditor
        brand={brand}
        onChange={onChange}
        brands={brands}
        onCopyHighlight={onCopyHighlight}
      />
      <section className="mt-8 rounded-xl border border-red-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-neutral-900">Tehlikeli alan</h2>
        <button type="button" onClick={() => { setError(null); setConfirm(true); }} className="mt-3 inline-flex h-9 items-center rounded-lg bg-red-600 px-3 text-sm font-medium text-white hover:bg-red-700">Markayı Sil</button>
      </section>
      {confirm ? <div className="fixed inset-0 z-50 grid place-items-center p-4" role="dialog" aria-modal="true" aria-label="Markayı Sil"><div className="fixed inset-0 bg-black/40" onClick={() => setConfirm(false)} /><div className="relative w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"><h2 className="text-lg font-semibold">Markayı Sil</h2><p className="mt-2 text-sm text-neutral-600">Bu marka ve markaya bağlı gönderiler, öne çıkanlar, takvim kayıtları ve medya kalıcı olarak silinecek. Bu işlem geri alınamaz.</p>{error ? <p role="alert" className="mt-3 text-sm text-red-700">{error}</p> : null}<div className="mt-6 flex justify-end gap-3"><button type="button" onClick={() => setConfirm(false)} className="h-9 rounded-lg border border-slate-200 px-3 text-sm">İptal</button><button type="button" onClick={() => void onDelete().catch((caught) => setError(caught instanceof Error ? caught.message : "Marka silinemedi."))} className="h-9 rounded-lg bg-red-600 px-3 text-sm font-medium text-white">Markayı Sil</button></div></div></div> : null}
    </div>
  );
}
