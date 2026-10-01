"use client";

import { PencilIcon, PlusIcon, SquaresPlusIcon } from "@heroicons/react/16/solid";

import {
  computeBrandCardStats,
  formatBrandActivity,
  type BrandCardStats,
} from "@/lib/brand-ops";
import type { GridProject } from "@/lib/storage";
import type { Brand } from "@/lib/types";

/**
 * Marka Seçim ekranı (§1/§3/§5): 2+ marka varsa açılışta
 * ve sidebar "Markalar" menüsünden gösterilir. Karttaki
 * tüm bilgiler gerçek state'ten hesaplanır; sahte veri
 * yoktur. `activeBrandId` yalnızca "Markayı Aç"ta
 * değişir (§11) — kartların kendisi tıklanabilir değildir.
 */
export default function BrandHub({
  brands,
  projects,
  activeBrandId,
  onOpenBrand,
  onNewBrand,
  onEditProfile,
}: {
  brands: Brand[];
  projects: GridProject[];
  activeBrandId: string;
  onOpenBrand: (id: string) => void;
  onNewBrand: () => void;
  onEditProfile: (brand: Brand) => void;
}) {
  // §12: hub, 0 marka durumuna dayanıklı (ileride marka
  // silme eklense bile ekran bozulmaz).
  if (brands.length === 0) {
    return (
      <div className="grid place-items-center rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center">
        <div>
          <div className="mx-auto mb-4 grid size-12 place-items-center rounded-2xl bg-sky-700 text-white">
            <SquaresPlusIcon className="size-6" aria-hidden="true" />
          </div>
          <h2 className="text-lg font-semibold text-neutral-900">
            Henüz marka oluşturulmadı.
          </h2>
          <p className="mt-1 text-sm text-neutral-500">
            İlk markanızı oluşturup aylık Instagram planlamasını başlayın.
          </p>
          <button
            type="button"
            onClick={onNewBrand}
            className="mt-5 inline-flex h-10 items-center gap-1.5 rounded-lg bg-sky-700 px-4 text-sm font-medium text-white hover:bg-sky-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
          >
            <PlusIcon className="size-4" aria-hidden="true" />
            İlk Markayı Oluştur
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-neutral-900">
          Markanızı seçin
        </h1>
        <p className="mt-1.5 text-sm text-neutral-500">
          Çalışmak istediğiniz markayı seçin veya yeni bir marka oluşturun.
        </p>
      </header>

      {/* Mobil: 1 kolon · tablet: 2 kolon · masaüstü: 3 kolon */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {brands.map((brand) => (
          <BrandCard
            key={brand.id}
            brand={brand}
            stats={computeBrandCardStats(brand.id, projects)}
            isActive={brand.id === activeBrandId}
            onOpen={() => onOpenBrand(brand.id)}
            onEdit={() => onEditProfile(brand)}
          />
        ))}

        {/* §7: '+ Yeni Marka' — mevcut NewBrandModal akışını
            kullanır; tekrarlayan form yazılmaz. */}
        <button
          type="button"
          onClick={onNewBrand}
          className="flex min-h-56 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-300 bg-white/60 p-5 text-neutral-500 transition hover:border-sky-600 hover:text-sky-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
        >
          <span className="grid size-10 place-items-center rounded-full border border-current" aria-hidden="true">
            <PlusIcon className="size-5" />
          </span>
          <span className="text-sm font-semibold">+ Yeni Marka</span>
          <span className="text-xs text-neutral-400">
            Aylık planlamaya başlayın
          </span>
        </button>
      </div>
    </div>
  );
}

function BrandCard({
  brand,
  stats,
  isActive,
  onOpen,
  onEdit,
}: {
  brand: Brand;
  stats: BrandCardStats;
  isActive: boolean;
  onOpen: () => void;
  onEdit: () => void;
}) {
  const initials = brand.name
    .trim()
    .split(/\s+/)
    .map((word) => word.charAt(0))
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <article
      className={`flex flex-col rounded-2xl border bg-white p-5 shadow-[0_2px_12px_rgba(0,0,0,.05)] transition focus-within:border-sky-600 ${
        isActive ? "border-sky-200" : "border-slate-200 hover:border-slate-300"
      }`}
    >
      <div className="flex items-start gap-3">
        {brand.profileImageUrl ? (
          <img
            src={brand.profileImageUrl}
            alt=""
            className="size-12 shrink-0 rounded-full object-cover"
          />
        ) : (
          <div
            className="grid size-12 shrink-0 place-items-center rounded-full bg-sky-700 text-sm font-semibold text-white"
            aria-hidden="true"
          >
            {initials || "?"}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-base font-semibold text-neutral-900">
              {brand.name}
            </h2>
            {isActive ? (
              <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                Aktif
              </span>
            ) : null}
          </div>
          <p className="truncate text-sm text-neutral-500">@{brand.username}</p>
        </div>
      </div>

      <dl className="mt-4 space-y-1.5 border-t border-slate-100 pt-3 text-sm">
        <div className="flex items-baseline justify-between gap-2">
          <dt className="text-neutral-500">Aylık plan</dt>
          <dd className="font-medium text-neutral-900">
            {stats.projectCount} aylık plan
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-2">
          <dt className="text-neutral-500">Aktif plan</dt>
          <dd className="font-medium text-neutral-900">
            {stats.latestProject ? stats.latestProject.name : "—"}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-2">
          <dt className="text-neutral-500">İçerik</dt>
          <dd className="font-medium text-neutral-900">
            {stats.contentCount} içerik
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-2">
          <dt className="text-neutral-500">Son güncelleme</dt>
          <dd className="font-medium text-neutral-900">
            {stats.lastUpdatedAt
              ? formatBrandActivity(stats.lastUpdatedAt)
              : "—"}
          </dd>
        </div>
      </dl>

      {/* §8: primary + en fazla bir secondary aksiyon. */}
      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={onOpen}
          className="h-9 flex-1 rounded-lg bg-sky-700 text-sm font-medium text-white hover:bg-sky-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
        >
          Markayı Aç
        </button>
        <button
          type="button"
          onClick={onEdit}
          className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-neutral-700 hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
        >
          <PencilIcon className="size-4" aria-hidden="true" />
          Profili Düzenle
        </button>
      </div>
    </article>
  );
}
