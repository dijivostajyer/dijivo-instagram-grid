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
  brands,
  onCopyHighlight,
}: {
  brand: Brand;
  onChange: (next: Brand) => void;
  /** §17: öne çıkan kopyalamak için marka kayıt defteri. */
  brands: Brand[];
  onCopyHighlight: (highlightId: string, targetBrandId: string) => string | null;
}) {
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
    </div>
  );
}
