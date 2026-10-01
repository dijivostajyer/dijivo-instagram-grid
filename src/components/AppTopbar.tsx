"use client";

import { Bars3Icon, CheckIcon } from "@heroicons/react/16/solid";

import type { GridProject } from "@/lib/storage";
import { VIEW_TITLES, type AppView } from "./AppSidebar";

/**
 * Üst bar: sayfa başlığı, "kaydedildi" göstergesi ve her ekranda erişilebilir
 * aylık proje seçici (proje seçimi artık geçici bir satır değil, kalıcı kontrol).
 */
export default function AppTopbar({
  view,
  projects,
  activeProjectId,
  onSelectProject,
  onOpenSidebar,
}: {
  view: AppView;
  projects: GridProject[];
  activeProjectId: string;
  onSelectProject: (id: string) => void;
  onOpenSidebar: () => void;
}) {
  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
      <div className="flex h-14 items-center gap-3 px-4 sm:px-6">
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
            htmlFor="project-select"
            className="hidden text-sm text-neutral-500 sm:inline"
          >
            Aylık proje
          </label>
          <select
            id="project-select"
            value={activeProjectId}
            onChange={(event) => onSelectProject(event.target.value)}
            aria-label="Aylık proje"
            className="h-9 max-w-[9rem] rounded-lg border border-slate-200 bg-white px-2 text-sm text-neutral-900 outline-none focus:border-sky-600 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-600 sm:max-w-[14rem]"
          >
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name} · {project.month}/{project.year}
              </option>
            ))}
          </select>
        </div>
      </div>
    </header>
  );
}
