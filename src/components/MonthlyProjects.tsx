"use client";

import { useMemo, useState } from "react";
import { CalendarDaysIcon, PlusIcon } from "@heroicons/react/24/outline";

import { monthLabel } from "@/lib/project-ops";
import type { GridProject } from "@/lib/storage";

function formatUpdated(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("tr-TR", { dateStyle: "medium", timeStyle: "short" });
}

/**
 * Aylık planlar ekranı: proje/ay listesi (ay bazlı gruplu), yeni aylık plan
 * oluşturma ve önceki ayı kopyalama. Aynı ayda birden fazla proje varsa
 * grup başlığında ve kartlarda açıkça görünür.
 */
export default function MonthlyProjects({
  projects,
  activeProjectId,
  onOpen,
  onCreate,
}: {
  projects: GridProject[];
  activeProjectId: string;
  /** Projeyi seçer ve planner'a götürür. */
  onOpen: (id: string) => void;
  onCreate: (name: string, month: number, year: number, copyPrevious: boolean) => string | null;
}) {
  const [creatorOpen, setCreatorOpen] = useState(false);

  const groups = useMemo(() => {
    const map = new Map<string, GridProject[]>();
    for (const project of projects) {
      const key = `${project.year}-${String(project.month).padStart(2, "0")}`;
      map.set(key, [...(map.get(key) ?? []), project]);
    }
    return [...map.entries()]
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([key, items]) => ({
        key,
        label: monthLabel(items[0].month, items[0].year),
        items: [...items].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      }));
  }, [projects]);

  return (
    <div className="mx-auto max-w-[1000px]">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-neutral-500">
            Her ay için bir veya daha fazla plan oluşturun; önceki ayı kopyalayarak başlayın.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCreatorOpen((open) => !open)}
          aria-expanded={creatorOpen}
          className="inline-flex h-10 items-center gap-2 rounded-lg bg-sky-700 px-4 text-sm font-medium text-white hover:bg-sky-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
        >
          <PlusIcon className="size-4" aria-hidden="true" />
          Yeni ay
        </button>
      </div>

      {creatorOpen ? (
        <div className="mb-6 rounded-xl border border-slate-200 bg-white p-4">
          <h3 className="mb-3 text-sm font-semibold text-neutral-900">Yeni aylık plan</h3>
          <ProjectCreator
            onCreate={(name, month, year, copyPrevious) => {
              const error = onCreate(name, month, year, copyPrevious);
              if (!error) setCreatorOpen(false);
              return error;
            }}
          />
        </div>
      ) : null}

      {groups.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-neutral-500">
          Henüz aylık plan yok. “Yeni ay” ile ilk planınızı oluşturun.
        </p>
      ) : (
        <div className="space-y-8">
          {groups.map((group) => (
            <section key={group.key}>
              <div className="mb-3 flex items-center gap-2">
                <CalendarDaysIcon className="size-4 text-neutral-400" aria-hidden="true" />
                <h3 className="text-sm font-semibold text-neutral-900">{group.label}</h3>
                {group.items.length > 1 ? (
                  <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-600">
                    {group.items.length} proje
                  </span>
                ) : null}
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                {group.items.map((project) => {
                  const isActive = project.id === activeProjectId;
                  const contentCount = project.existingPosts.length + project.plannedPosts.length;
                  return (
                    <div
                      key={project.id}
                      className={`rounded-xl border bg-white p-4 ${
                        isActive ? "border-sky-400 ring-1 ring-sky-200" : "border-slate-200"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-neutral-900">
                            {project.name}
                          </p>
                          <p className="mt-0.5 text-xs text-neutral-500">
                            {monthLabel(project.month, project.year)} · {contentCount} içerik
                          </p>
                          <p className="mt-0.5 text-xs text-neutral-400">
                            Son güncelleme: {formatUpdated(project.updatedAt)}
                          </p>
                        </div>
                        {isActive ? (
                          <span className="shrink-0 rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-700">
                            Aktif
                          </span>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        onClick={() => onOpen(project.id)}
                        aria-label={`Aç: ${project.name}`}
                        className="mt-3 inline-flex h-9 items-center rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-neutral-800 hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
                      >
                        Aç
                      </button>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

/** Yeni aylık plan oluşturma formu (önceki ayı kopyalama dahil). */
function ProjectCreator({
  onCreate,
}: {
  onCreate: (name: string, month: number, year: number, copyPrevious: boolean) => string | null;
}) {
  const now = new Date();
  const [name, setName] = useState("");
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [copyPrevious, setCopyPrevious] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const result = onCreate(name, month, year, copyPrevious);
        setError(result);
      }}
    >
      <label className="text-sm text-neutral-600">
        Proje adı
        <input
          aria-label="Proje adı"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Örn. Ekim kampanya"
          className="mt-1.5 block h-9 w-40 rounded-lg border border-slate-200 bg-white px-2.5 text-sm outline-none focus:border-sky-600 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-600"
        />
      </label>
      <label className="text-sm text-neutral-600">
        Ay
        <input
          aria-label="Ay"
          type="number"
          min={1}
          max={12}
          value={month}
          onChange={(event) => setMonth(Number(event.target.value))}
          className="mt-1.5 block h-9 w-16 rounded-lg border border-slate-200 bg-white px-2 text-sm outline-none focus:border-sky-600"
        />
      </label>
      <label className="text-sm text-neutral-600">
        Yıl
        <input
          aria-label="Yıl"
          type="number"
          min={2020}
          value={year}
          onChange={(event) => setYear(Number(event.target.value))}
          className="mt-1.5 block h-9 w-20 rounded-lg border border-slate-200 bg-white px-2 text-sm outline-none focus:border-sky-600"
        />
      </label>
      <label className="flex h-9 items-center gap-2 text-sm text-neutral-700">
        <input
          type="checkbox"
          checked={copyPrevious}
          onChange={(event) => setCopyPrevious(event.target.checked)}
          className="size-4 accent-sky-700"
        />
        Öncekini kopyala
      </label>
      <button
        type="submit"
        className="h-9 rounded-lg bg-neutral-900 px-3 text-sm font-medium text-white hover:bg-neutral-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
      >
        Oluştur
      </button>
      {error ? (
        <p role="alert" className="w-full text-sm text-red-700">
          {error}
        </p>
      ) : null}
    </form>
  );
}
