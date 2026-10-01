"use client";

import { ArrowRightIcon } from "@heroicons/react/24/outline";

import { monthLabel } from "@/lib/project-ops";
import type { GridProject } from "@/lib/storage";
import type { Brand, GridResult } from "@/lib/types";
import type { AppView } from "./AppSidebar";

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

/**
 * Uygulama açılış ekranı: aktif marka/ay özeti, içerik istatistikleri,
 * paylaşım durumu, son proje ve aylık plan kartları.
 * Karmaşık grid ekranına doğrudan düşmez; "Projeye devam et" planner'ı açar.
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

  return (
    <div className="mx-auto max-w-[1200px]">
      <div className="mb-6">
        <p className="text-sm text-neutral-500">Hoş geldiniz</p>
        <h2 className="text-2xl font-semibold tracking-tight text-neutral-900">
          {brand.name || "İsimsiz marka"}
        </h2>
        <p className="mt-1 text-sm text-neutral-600">
          Aylık Instagram planınızı ve müşteri sunumunuzu tek panelden yönetin.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard label="Aktif marka" value={brand.name || "İsimsiz marka"} hint={`@${brand.username}`} />
        <StatCard
          label="Aktif ay"
          value={active ? monthLabel(active.month, active.year) : "—"}
          hint={active?.name}
        />
        <StatCard label="Mevcut gönderi" value={String(existingCount)} hint={`${result.cells.length} hücre gridde`} />
        <StatCard label="Planlanan içerik" value={String(plannedCount)} hint="Yayın sırası sürükle-bırak ile ayarlanır" />
        <StatCard label="Sabitlenmiş" value={`${result.pinnedCount}/3`} hint="En fazla 3 gönderi sabitlenir" />
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">Paylaşım</p>
          {shareLink ? (
            <a
              href={shareLink}
              target="_blank"
              rel="noreferrer"
              className="mt-1.5 block truncate text-sm font-medium text-sky-700 underline hover:text-sky-900"
            >
              Son paylaşım bağlantısı hazır
            </a>
          ) : (
            <p className="mt-1.5 text-sm text-neutral-500">Henüz bağlantı oluşturulmadı.</p>
          )}
          <button
            type="button"
            onClick={() => onNavigate("share")}
            className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-sky-700 hover:text-sky-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
          >
            Paylaşım alanı <ArrowRightIcon className="size-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>

      {lastProject ? (
        <div className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-5">
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
