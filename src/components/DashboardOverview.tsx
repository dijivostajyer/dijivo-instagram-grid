"use client";

import {
  ArrowRightIcon,
  ArrowDownTrayIcon,
  CalendarDaysIcon,
  PhotoIcon,
  ShareIcon,
  Squares2X2Icon,
  UserCircleIcon,
} from "@heroicons/react/24/outline";

import { computePlanStats } from "@/lib/plan-stats";
import { monthLabel } from "@/lib/project-ops";
import type { GridProject } from "@/lib/storage";
import type { Brand, GridResult } from "@/lib/types";
import type { AppView } from "./AppSidebar";
import MiniGridPreview from "./MiniGridPreview";

function formatUpdated(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("tr-TR", { dateStyle: "medium", timeStyle: "short" });
}

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">{label}</p>
      <p className="mt-1.5 truncate text-lg font-semibold text-neutral-900">{value}</p>
      {hint ? <p className="mt-0.5 truncate text-sm text-neutral-500">{hint}</p> : null}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-slate-100 py-1.5 last:border-b-0">
      <dt className="text-sm text-neutral-500">{label}</dt>
      <dd className="text-sm font-semibold text-neutral-900">{value}</dd>
    </div>
  );
}

const QUICK_ACTIONS: Array<{ view: AppView; label: string; icon: typeof CalendarDaysIcon }> = [
  { view: "planner", label: "Grid Planner", icon: Squares2X2Icon },
  { view: "plans", label: "Yeni Aylık Plan", icon: CalendarDaysIcon },
  { view: "profile", label: "Profili Düzenle", icon: UserCircleIcon },
  { view: "planner", label: "Görsel Yükle", icon: PhotoIcon },
  { view: "share", label: "Paylaş", icon: ShareIcon },
  { view: "export", label: "PDF / JPG", icon: ArrowDownTrayIcon },
];

/**
 * Uygulama açılış ekranı: aktif marka/ay özeti, tür dağılımı, gerçek sayılarla
 * proje sağlığı, mini grid önizlemesi, hızlı işlemler, son proje ve aylık plan
 * kartları. Sahte yüzde üretilmez; tüm metrikler state'ten hesaplanır.
 */
export default function DashboardOverview({
  brand,
  result,
  existingCount,
  plannedCount,
  projects,
  activeProjectId,
  shareLink,
  onOpenProject,
  onNavigate,
}: {
  brand: Brand;
  result: GridResult;
  existingCount: number;
  plannedCount: number;
  projects: GridProject[];
  activeProjectId: string;
  shareLink: string | null;
  onOpenProject: (id: string) => void;
  onNavigate: (view: AppView) => void;
}) {
  const active = projects.find((project) => project.id === activeProjectId) ?? projects[0];
  const lastProject = [...projects].sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  )[0];

  const stats = computePlanStats(active?.existingPosts ?? [], active?.plannedPosts ?? []);
  const typeTotal = stats.post + stats.reel + stats.carousel;
  const segments = [
    { key: "post", label: "Post", count: stats.post, cls: "bg-neutral-700" },
    { key: "reel", label: "Reel", count: stats.reel, cls: "bg-sky-600" },
    { key: "carousel", label: "Carousel", count: stats.carousel, cls: "bg-amber-500" },
  ];

  return (
    <div className="mx-auto max-w-[1200px]">
      <div className="mb-5">
        <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">
          Dijivo Dashboard
        </p>
        <h2 className="mt-1 text-2xl font-semibold tracking-tight text-neutral-900">
          {brand.name || "İsimsiz marka"}
        </h2>
        <p className="mt-1 text-sm text-neutral-600">
          @{brand.username} · {projects.length} aylık plan
          {active ? ` · Aktif: ${monthLabel(active.month, active.year)}` : ""} ·{" "}
          {result.cells.length} içerik
        </p>
      </div>

      {/* Üst özet */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Aktif marka" value={brand.name || "İsimsiz marka"} hint={`@${brand.username}`} />
        <StatCard
          label="Aktif ay"
          value={active ? monthLabel(active.month, active.year) : "—"}
          hint={active?.name}
        />
        <StatCard label="Toplam grid içeriği" value={String(result.cells.length)} hint={`${result.rowCount} satır`} />
        <StatCard label="Mevcut içerik" value={String(existingCount)} />
        <StatCard label="Planlanan içerik" value={String(plannedCount)} />
        <StatCard label="Sabitlenen" value={`${result.pinnedCount}/3`} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        {/* İçerik dağılımı */}
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">İçerik dağılımı</p>
          {typeTotal === 0 ? (
            <p className="mt-3 text-sm text-neutral-500">Henüz içerik yok.</p>
          ) : (
            <>
              <div className="mt-3 flex h-2.5 w-full overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
                {segments.map((segment) =>
                  segment.count > 0 ? (
                    <div
                      key={segment.key}
                      className={segment.cls}
                      style={{ width: `${(segment.count / typeTotal) * 100}%` }}
                    />
                  ) : null,
                )}
              </div>
              <ul className="mt-3 space-y-1.5">
                {segments.map((segment) => (
                  <li key={segment.key} className="flex items-center gap-2 text-sm">
                    <span className={`size-2.5 shrink-0 rounded-sm ${segment.cls}`} aria-hidden="true" />
                    <span className="text-neutral-600">{segment.label}</span>
                    <span className="ml-auto font-semibold text-neutral-900">{segment.count}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        {/* Aktif plan sağlığı — gerçek sayılar */}
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">
            Aktif plan özeti
          </p>
          <dl className="mt-2">
            <InfoRow label="Toplam içerik" value={`${stats.total}`} />
            <InfoRow label="Mevcut" value={`${stats.existing}`} />
            <InfoRow label="Planlanan" value={`${stats.planned}`} />
            <InfoRow label="Pinned" value={`${stats.pinned}/3`} />
            <InfoRow
              label="Paylaşım"
              value={shareLink ? "Paylaşım hazır" : "Paylaşım oluşturulmadı"}
            />
            <InfoRow label="Çıktı" value="PDF · JPG · A4 300 DPI" />
          </dl>
          <div className="mt-3 flex flex-wrap gap-2">
            {shareLink ? (
              <a
                href={shareLink}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-8 items-center rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium text-sky-700 hover:bg-sky-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
              >
                Bağlantıyı aç
              </a>
            ) : (
              <button
                type="button"
                onClick={() => onNavigate("share")}
                className="inline-flex h-8 items-center rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
              >
                Paylaşım oluştur
              </button>
            )}
            <button
              type="button"
              onClick={() => onNavigate("export")}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
            >
              <ArrowDownTrayIcon className="size-3.5" aria-hidden="true" />
              Dışa aktar
            </button>
          </div>
        </div>

        {/* Mini grid preview */}
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">
              Grid önizleme
            </p>
            <span className="text-xs text-neutral-400">salt-okunur</span>
          </div>
          <div className="mt-3 max-w-[220px]">
            <MiniGridPreview cells={result.cells} max={9} />
          </div>
          <button
            type="button"
            onClick={() => onNavigate("planner")}
            className="mt-3 inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-lg bg-neutral-900 px-3 text-sm font-medium text-white hover:bg-neutral-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
          >
            Grid Planner'a Git <ArrowRightIcon className="size-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Hızlı işlemler */}
      <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">Hızlı işlemler</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {QUICK_ACTIONS.map((action) => {
            const Icon = action.icon;
            return (
              <button
                key={action.label}
                type="button"
                onClick={() => onNavigate(action.view)}
                className="flex items-center gap-2.5 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-left text-sm font-medium text-neutral-800 transition hover:border-sky-300 hover:bg-sky-50/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
              >
                <Icon className="size-4 shrink-0 text-sky-700" aria-hidden="true" />
                <span className="truncate">{action.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Son proje */}
      {lastProject ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-5">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">Son proje</p>
            <p className="mt-1 truncate text-base font-semibold text-neutral-900">{lastProject.name}</p>
            <p className="text-sm text-neutral-500">
              {monthLabel(lastProject.month, lastProject.year)} ·{" "}
              {lastProject.existingPosts.length + lastProject.plannedPosts.length} içerik ·{" "}
              {formatUpdated(lastProject.updatedAt)} güncellendi
            </p>
          </div>
          <button
            type="button"
            onClick={() => onOpenProject(lastProject.id)}
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-sky-700 px-4 text-sm font-medium text-white hover:bg-sky-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
          >
            Projeye devam et <ArrowRightIcon className="size-4" aria-hidden="true" />
          </button>
        </div>
      ) : null}

      {/* Aylık planlar */}
      <div className="mt-8">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-neutral-900">Aylık planlar</h3>
          <button
            type="button"
            onClick={() => onNavigate("plans")}
            className="inline-flex items-center gap-1 text-sm font-medium text-sky-700 hover:text-sky-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
          >
            Tümünü gör <ArrowRightIcon className="size-3.5" aria-hidden="true" />
          </button>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => {
            const isActive = project.id === activeProjectId;
            return (
              <button
                key={project.id}
                type="button"
                onClick={() => onOpenProject(project.id)}
                className={`rounded-xl border bg-white p-4 text-left transition hover:border-sky-300 hover:shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600 ${
                  isActive ? "border-sky-400 ring-1 ring-sky-200" : "border-slate-200"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-semibold text-neutral-900">
                    {monthLabel(project.month, project.year)}
                  </p>
                  {isActive ? (
                    <span className="shrink-0 rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-700">
                      Aktif
                    </span>
                  ) : null}
                </div>
                <p className="mt-0.5 truncate text-sm text-neutral-600">{project.name}</p>
                <p className="mt-2 text-xs text-neutral-500">
                  {project.existingPosts.length} mevcut · {project.plannedPosts.length} planlanan
                </p>
                <p className="mt-0.5 text-xs text-neutral-400">{formatUpdated(project.updatedAt)}</p>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
