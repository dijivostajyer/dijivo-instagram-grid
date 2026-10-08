"use client";

import { Bars3Icon, CheckIcon, PlusIcon } from "@heroicons/react/16/solid";

import type { GridProject } from "@/lib/storage";
import type { Brand } from "@/lib/types";
import { VIEW_TITLES, type AppView } from "./AppSidebar";

/**
 * Üst bar: sayfa başlığı, "kaydedildi" göstergesi ve iki seviyeli
 * Marka + Aylık Plan seçici (§5). Plan seçici yalnızca aktif
 * markaya ait projeleri listeler; '+ Yeni Marka' yeni giriş
 * gerektirmeden mevcut workspace'a marka ekler (§3).
 */
export default function AppTopbar({
  view,
  brands,
  activeBrandId,
  onSelectBrand,
  onNewBrand,
  projects,
  activeProjectId,
  onSelectProject,
  onOpenSidebar,
  userEmail,
  onLogout,
}: {
  view: AppView;
  brands: Brand[];
  activeBrandId: string;
  onSelectBrand: (id: string) => void;
  onNewBrand: () => void;
  projects: GridProject[];
  activeProjectId: string;
  onSelectProject: (id: string) => void;
  onOpenSidebar: () => void;
  userEmail: string;
  onLogout: () => void;
}) {
  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
      <div className="flex min-h-14 flex-wrap items-center gap-x-2 gap-y-2 px-4 py-2 sm:h-14 sm:flex-nowrap sm:gap-x-3 sm:py-0 sm:px-6">
        <button
          type="button"
          aria-label="Menüyü aç"
          onClick={onOpenSidebar}
          className="grid size-9 shrink-0 place-items-center rounded-lg text-neutral-600 hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600 lg:hidden"
        >
          <Bars3Icon className="size-5" aria-hidden="true" />
        </button>

        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-semibold text-neutral-900">
            {VIEW_TITLES[view]}
          </h1>
        </div>

        <div className="hidden items-center gap-1.5 text-sm text-neutral-500 md:flex">
          <CheckIcon className="size-4 shrink-0 text-emerald-600" aria-hidden="true" />
          Tarayıcınıza kaydedildi
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <label
            htmlFor="brand-select"
            className="hidden text-sm text-neutral-500 xl:inline"
          >
            Marka
          </label>
          <select
            id="brand-select"
            value={activeBrandId}
            onChange={(event) => onSelectBrand(event.target.value)}
            aria-label="Marka"
            className="h-9 max-w-[7rem] rounded-lg border border-slate-200 bg-white px-2 text-sm text-neutral-900 outline-none focus:border-sky-600 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-600 sm:max-w-[10rem]"
          >
            {brands.map((brand) => (
              <option key={brand.id} value={brand.id}>
                {brand.name}
              </option>
            ))}
          </select>

          <label
            htmlFor="project-select"
            className="hidden text-sm text-neutral-500 xl:inline"
          >
            Plan
          </label>
          <select
            id="project-select"
            value={activeProjectId}
            onChange={(event) => onSelectProject(event.target.value)}
            aria-label="Aylık plan"
            className="h-9 max-w-[8rem] rounded-lg border border-slate-200 bg-white px-2 text-sm text-neutral-900 outline-none focus:border-sky-600 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-600 sm:max-w-[12rem]"
          >
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name} · {project.month}/{project.year}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={onNewBrand}
            className="inline-flex h-9 shrink-0 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
          >
            <PlusIcon className="size-4" aria-hidden="true" />
            <span className="hidden sm:inline">Yeni Marka</span>
          </button>
          <button type="button" onClick={onLogout} className="hidden text-sm text-neutral-500 underline md:inline" title={userEmail}>Çıkış</button>
        </div>
      </div>
    </header>
  );
}
