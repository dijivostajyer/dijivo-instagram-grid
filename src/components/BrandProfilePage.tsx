"use client";

import BrandEditor from "@/components/BrandEditor";
import type { Brand } from "@/lib/types";

/**
 * Marka profili yönetim sayfası. Eski drawer yerine sidebar'dan erişilen
 * tam sayfadır; alanlar ve otomatik kaydetme davranışı değişmemiştir.
 */
export default function BrandProfilePage({
  brand,
  onChange,
}: {
  brand: Brand;
  onChange: (next: Brand) => void;
}) {
  return (
    <div className="mx-auto max-w-[760px]">
      <p className="mb-6 text-sm text-neutral-500">
        Profil fotoğrafı, marka bilgileri, istatistikler ve öne çıkanlar. Değişiklikler
        otomatik olarak tarayıcınıza kaydedilir.
      </p>
      <div className="rounded-xl border border-slate-200 bg-white p-5 sm:p-6">
        <BrandEditor brand={brand} onChange={onChange} />
      </div>
    </div>
  );
}
