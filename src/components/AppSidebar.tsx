"use client";

import {
  ArrowDownTrayIcon,
  CalendarDaysIcon,
  CalendarIcon,
  Cog6ToothIcon,
  HomeIcon,
  IdentificationIcon,
  ShareIcon,
  Squares2X2Icon,
  UserCircleIcon,
} from "@heroicons/react/24/outline";

import { withBasePath } from "@/lib/base-path";

/** Uygulama içi görünüm kimliği. Yeni route açılmaz; navigasyon state'tedir. */
export type AppView =
  | "brands"
  | "overview"
  | "plans"
  | "calendar"
  | "planner"
  | "profile"
  | "share"
  | "export"
  | "settings";

const NAV_ITEMS: Array<{
  view: AppView;
  label: string;
  icon: typeof HomeIcon;
}> = [
  { view: "brands", label: "Markalar", icon: IdentificationIcon },
  { view: "overview", label: "Genel Bakış", icon: HomeIcon },
  { view: "plans", label: "Aylık Planlar", icon: CalendarDaysIcon },
  { view: "calendar", label: "Takvim", icon: CalendarIcon },
  { view: "planner", label: "Grid Planner", icon: Squares2X2Icon },
  { view: "profile", label: "Marka Profili", icon: UserCircleIcon },
  { view: "share", label: "Paylaşım", icon: ShareIcon },
  { view: "export", label: "Dışa Aktarma", icon: ArrowDownTrayIcon },
  { view: "settings", label: "Ayarlar", icon: Cog6ToothIcon },
];

export const VIEW_TITLES: Record<AppView, string> = {
  brands: "Markalar",
  overview: "Genel Bakış",
  plans: "Aylık Planlar",
  calendar: "Takvim",
  planner: "Grid Planner",
  profile: "Marka Profili",
  share: "Paylaşım",
  export: "Dışa Aktarma",
  settings: "Ayarlar",
};

/**
 * Uygulama sidebar'ı: masaüstünde sabit, mobilde drawer içinde kullanılır.
 * Yalnızca gezinme sunar; uygulama state'ine dokunmaz.
 */
export default function AppSidebar({
  view,
  onNavigate,
}: {
  view: AppView;
  onNavigate: (view: AppView) => void;
}) {
  return (
    <div className="flex h-full flex-col bg-neutral-900 text-neutral-300">
      <button type="button" onClick={() => onNavigate("brands")} className="flex items-center gap-3 border-b border-white/10 px-5 py-4 text-left hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-sky-400" aria-label="Marka ve proje seçimine dön">
        <img src={withBasePath("/brand/dijivo-logo.png")} alt="Dijivo" className="h-8 w-auto max-w-28 object-contain sm:h-9 sm:max-w-32" />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-white">Dijivo Grid</p>
          <p className="truncate text-xs text-neutral-400">Instagram Grid Planner</p>
        </div>
      </button>

      <nav aria-label="Ana gezinme" className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = item.view === view;
          return (
            <button
              key={item.view}
              type="button"
              onClick={() => onNavigate(item.view)}
              aria-current={active ? "page" : undefined}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400 ${
                active
                  ? "bg-white/10 font-medium text-white"
                  : "text-neutral-300 hover:bg-white/5 hover:text-white"
              }`}
            >
              <Icon className="size-4 shrink-0" aria-hidden="true" />
              <span className="truncate">{item.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="border-t border-white/10 px-5 py-3 text-xs text-neutral-500">
        Yerel depolama etkin · Otomatik kaydetme
      </div>
    </div>
  );
}
