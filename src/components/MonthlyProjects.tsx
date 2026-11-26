"use client";

import { useMemo, useState } from "react";
import { CalendarDaysIcon, DocumentDuplicateIcon, PlusIcon } from "@heroicons/react/24/outline";

import MiniGridPreview from "@/components/MiniGridPreview";
import { computeGrid } from "@/lib/grid";
import { computePlanStats } from "@/lib/plan-stats";
import {
  duplicateMonthMessage,
  findProjectForMonth,
  firstFreeMonth,
  monthLabel,
  monthName,
  projectBrandId,
  takenMonthsOfYear,
} from "@/lib/project-ops";
import type { GridProject } from "@/lib/storage";

function formatUpdated(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("tr-TR", { dateStyle: "medium", timeStyle: "short" });
}

interface CreatorPrefill {
  month: number;
  year: number;
  copy: boolean;
}

/** Ay değeri sonraki aya kaydırılır (Ocak → Şubat, Aralık → yeni yıl). */
function nextMonthOf(month: number, year: number): { month: number; year: number } {
  return month === 12 ? { month: 1, year: year + 1 } : { month: month + 1, year };
}

/**
 * Aylık planlar ekranı: yıl başlığı altında aylar, her ay için zengin plan
 * kartı (mini grid, gerçek dağılım metrikleri, aksiyonlar). Yeni plan ve
 * önceki ayı kopyalama formları burada açılır; proje modeli değişmedi.
 */
export default function MonthlyProjects({
  projects,
  activeProjectId,
  shareLink,
  onOpen,
  onCreate,
  brandId,
  loading = false,
}: {
  projects: GridProject[];
  activeProjectId: string;
  /** Oluşturulan son paylaşım bağlantısı; aktif kartta durum göstergesi. */
  shareLink: string | null;
  /** Projeyi aktif yapar ve planner'a götürür (Planı Aç). */
  onOpen: (id: string) => void;
  onCreate: (name: string, month: number, year: number, copyPrevious: boolean) => string | null;
  /** Aktif marka: aynı marka + ay + yıl için tek plan kuralı bu markaya göre denetlenir. */
  brandId?: string;
  /** Plan listesi yüklenirken form gönderimi engellenir. */
  loading?: boolean;
}) {
  const [creator, setCreator] = useState<CreatorPrefill | null>(null);
  // `projects` aktif markanın planlarıdır; marka verilmemişse ilk planın markası kullanılır.
  const activeBrandId = brandId ?? (projects[0] ? projectBrandId(projects[0]) : "");

  const years = useMemo(() => {
    const byYear = new Map<number, Map<number, GridProject[]>>();
    for (const project of projects) {
      const months = byYear.get(project.year) ?? new Map<number, GridProject[]>();
      months.set(project.month, [...(months.get(project.month) ?? []), project]);
      byYear.set(project.year, months);
    }
    return [...byYear.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([year, months]) => ({
        year,
        months: [...months.entries()]
          .sort((a, b) => b[0] - a[0])
          .map(([month, items]) => ({
            month,
            items: [...items].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
          })),
      }));
  }, [projects]);

  // En son planın bir sonraki ayı: henüz oluşturulmamış plan boş durumu.
  const upcoming = useMemo(() => {
    if (projects.length === 0) return null;
    const maxKey = projects.reduce(
      (max, project) => Math.max(max, project.year * 12 + (project.month - 1)),
      0,
    );
    const nextKey = maxKey + 1;
    const next = { month: (nextKey % 12) + 1, year: Math.floor(nextKey / 12) };
    const exists = projects.some(
      (project) => project.month === next.month && project.year === next.year,
    );
    return exists ? null : next;
  }, [projects]);

  function openCreator(copy: boolean, month?: number, year?: number) {
    const now = new Date();
    setCreator({
      month: month ?? now.getMonth() + 1,
      year: year ?? now.getFullYear(),
      copy,
    });
  }

  return (
    <div className="mx-auto max-w-[1000px]">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">
            Dijivo / Aylık Planlar
          </p>
          <p className="mt-1 text-sm text-neutral-500">
            Her marka için her ayın tek bir aylık planı olur; yeni bir ay ekleyin veya önceki ayı kopyalayarak başlayın.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => openCreator(true)}
            className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 text-sm font-medium text-neutral-800 hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
          >
            <DocumentDuplicateIcon className="size-4" aria-hidden="true" />
            Önceki Ayı Kopyala
          </button>
          <button
            type="button"
            onClick={() => openCreator(false)}
            aria-expanded={creator !== null}
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-sky-700 px-4 text-sm font-medium text-white hover:bg-sky-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
          >
            <PlusIcon className="size-4" aria-hidden="true" />
            Yeni ay
          </button>
        </div>
      </div>

      {creator ? (
        <div className="mb-6 rounded-xl border border-slate-200 bg-white p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-neutral-900">
              Yeni aylık plan {creator.copy ? "· önceki ayı kopyala" : ""}
            </h3>
            <button
              type="button"
              aria-label="Formu kapat"
              onClick={() => setCreator(null)}
              className="rounded-md px-2 py-1 text-sm font-medium text-neutral-500 hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
            >
              Kapat
            </button>
          </div>
          <ProjectCreator
            key={`${creator.month}-${creator.year}-${creator.copy}`}
            initial={creator}
            brandId={activeBrandId}
            projects={projects}
            loading={loading}
            onCreate={(name, month, year, copyPrevious) => {
              const error = onCreate(name, month, year, copyPrevious);
              if (!error) setCreator(null);
              return error;
            }}
          />
        </div>
      ) : null}

      {projects.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center">
          <CalendarDaysIcon className="mx-auto size-6 text-neutral-400" aria-hidden="true" />
          <p className="mt-3 text-sm font-medium text-neutral-800">
            Henüz aylık plan yok.
          </p>
          <p className="mt-1 text-sm text-neutral-500">
            İlk planınızı oluşturun veya önceki ayın planını kopyalayın.
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <button
              type="button"
              onClick={() => openCreator(false)}
              className="h-9 rounded-lg bg-sky-700 px-3 text-sm font-medium text-white hover:bg-sky-800"
            >
              Yeni plan oluştur
            </button>
            <button
              type="button"
              onClick={() => openCreator(true)}
              className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-neutral-800 hover:bg-neutral-50"
            >
              Önceki ayı kopyala
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-10">
          {years.map((yearGroup) => (
            <section key={yearGroup.year}>
              <div className="mb-4 flex items-baseline gap-3 border-b border-slate-200 pb-2">
                <h3 className="text-lg font-semibold tracking-tight text-neutral-900">
                  {yearGroup.year}
                </h3>
                <span className="text-xs text-neutral-400">
                  {yearGroup.months.length} ay planlanmış
                </span>
              </div>

              <div className="space-y-6">
                {yearGroup.months.map((monthGroup) => (
                  <div key={`${yearGroup.year}-${monthGroup.month}`}>
                    <div className="mb-2.5 flex items-center gap-2">
                      <CalendarDaysIcon className="size-4 text-neutral-400" aria-hidden="true" />
                      <h4 className="text-sm font-semibold text-neutral-800">
                        {monthName(monthGroup.month)}
                      </h4>
                    </div>
                    <div className="grid gap-4 lg:grid-cols-2">
                      {monthGroup.items.map((project) => (
                        <PlanCard
                          key={project.id}
                          project={project}
                          isActive={project.id === activeProjectId}
                          shareStatus={
                            project.id === activeProjectId
                              ? shareLink
                                ? "ready"
                                : "none"
                              : null
                          }
                          shareLink={shareLink}
                          onOpen={() => onOpen(project.id)}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}

          {/* Sonraki ay: henüz planlanmamış boş ay durumu */}
          {upcoming ? (
            <section>
              <div className="mb-4 flex items-baseline gap-3 border-b border-slate-200 pb-2">
                <h3 className="text-lg font-semibold tracking-tight text-neutral-400">
                  {upcoming.year}
                </h3>
                <span className="text-xs text-neutral-400">sıradaki ay</span>
              </div>
              <div className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center">
                <p className="text-sm font-medium text-neutral-800">
                  {monthName(upcoming.month)} {upcoming.year} için henüz plan oluşturulmadı.
                </p>
                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  <button
                    type="button"
                    onClick={() => openCreator(false, upcoming.month, upcoming.year)}
                    className="h-9 rounded-lg bg-sky-700 px-3 text-sm font-medium text-white hover:bg-sky-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
                  >
                    Yeni plan oluştur
                  </button>
                  <button
                    type="button"
                    onClick={() => openCreator(true, upcoming.month, upcoming.year)}
                    className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-neutral-800 hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
                  >
                    Önceki ayı kopyala
                  </button>
                </div>
              </div>
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}

/** Zengin plan kartı: mini grid, gerçek dağılım metrikleri ve aksiyonlar. */
function PlanCard({
  project,
  isActive,
  shareStatus,
  shareLink,
  onOpen,
}: {
  project: GridProject;
  isActive: boolean;
  shareStatus: "ready" | "none" | null;
  shareLink: string | null;
  onOpen: () => void;
}) {
  const stats = computePlanStats(project.existingPosts, project.plannedPosts);
  const cells = useMemo(
    () => computeGrid(project.existingPosts, project.plannedPosts).cells,
    [project.existingPosts, project.plannedPosts],
  );

  return (
    <div
      className={`rounded-xl border bg-white p-4 transition ${
        isActive ? "border-sky-400 ring-1 ring-sky-200" : "border-slate-200"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-neutral-900">{project.name}</p>
          <p className="mt-0.5 text-xs text-neutral-500">
            {monthLabel(project.month, project.year)} · {stats.total} içerik
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {isActive ? (
            <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-700">
              Aktif
            </span>
          ) : null}
          {shareStatus === "ready" ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
              Paylaşım hazır
            </span>
          ) : shareStatus === "none" ? (
            <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-500">
              Paylaşım oluşturulmadı
            </span>
          ) : null}
        </div>
      </div>

      <div className="mt-3 flex gap-4">
        <div className="w-24 shrink-0">
          <MiniGridPreview cells={cells} max={6} />
        </div>
        <dl className="grid min-w-0 flex-1 grid-cols-2 gap-x-4 text-xs">
          <div className="flex justify-between border-b border-slate-100 py-1">
            <dt className="text-neutral-500">Toplam</dt>
            <dd className="font-semibold text-neutral-900">{stats.total}</dd>
          </div>
          <div className="flex justify-between border-b border-slate-100 py-1">
            <dt className="text-neutral-500">Pinned</dt>
            <dd className="font-semibold text-neutral-900">{stats.pinned}/3</dd>
          </div>
          <div className="flex justify-between border-b border-slate-100 py-1">
            <dt className="text-neutral-500">Mevcut</dt>
            <dd className="font-semibold text-neutral-900">{stats.existing}</dd>
          </div>
          <div className="flex justify-between border-b border-slate-100 py-1">
            <dt className="text-neutral-500">Planlanan</dt>
            <dd className="font-semibold text-neutral-900">{stats.planned}</dd>
          </div>
          <div className="flex justify-between border-b border-slate-100 py-1">
            <dt className="text-neutral-500">Reel</dt>
            <dd className="font-semibold text-neutral-900">{stats.reel}</dd>
          </div>
          <div className="flex justify-between border-b border-slate-100 py-1">
            <dt className="text-neutral-500">Carousel</dt>
            <dd className="font-semibold text-neutral-900">{stats.carousel}</dd>
          </div>
        </dl>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-neutral-400">
          Son güncelleme: {formatUpdated(project.updatedAt)}
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onOpen}
            aria-label={`Planı Aç: ${project.name}`}
            className="inline-flex h-9 items-center rounded-lg bg-neutral-900 px-3 text-sm font-medium text-white hover:bg-neutral-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
          >
            Planı Aç
          </button>
        </div>
      </div>
      {shareStatus === "ready" && shareLink ? (
        <a
          href={shareLink}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-block truncate text-xs text-sky-700 underline hover:text-sky-900"
        >
          {shareLink}
        </a>
      ) : null}
    </div>
  );
}

/** Yeni aylık plan oluşturma formu (önceki ayı kopyalama dahil). */
function ProjectCreator({
  initial,
  brandId,
  projects,
  loading,
  onCreate,
}: {
  initial?: CreatorPrefill;
  brandId: string;
  projects: GridProject[];
  loading: boolean;
  onCreate: (name: string, month: number, year: number, copyPrevious: boolean) => string | null;
}) {
  const now = new Date();
  const [name, setName] = useState("");
  const [year, setYear] = useState(initial?.year ?? now.getFullYear());
  const [month, setMonth] = useState(() => {
    // Yalnızca gerçekten oluşturulabilir bir ay önerilir (varsa istenen ay, yoksa ilk boş ay).
    const wanted = initial?.month ?? now.getMonth() + 1;
    return firstFreeMonth(takenMonthsOfYear(projects, brandId, initial?.year ?? now.getFullYear()), wanted) ?? wanted;
  });
  const [copyPrevious, setCopyPrevious] = useState(initial?.copy ?? false);
  const [error, setError] = useState<string | null>(null);

  const takenMonths = useMemo(() => takenMonthsOfYear(projects, brandId, year), [projects, brandId, year]);
  const yearValid = Number.isInteger(year) && year >= 2000;
  const existing = yearValid && !loading ? findProjectForMonth(projects, brandId, month, year) : null;
  const allTaken = yearValid && takenMonths.size >= 12;
  // Seçilen ay doluysa kullanıcıya nedenini alanın yanında açıklarız; gönderim kapalıdır.
  const fieldMessage = existing ? duplicateMonthMessage(month, year) : null;
  const blocked = loading || !brandId || !yearValid || existing !== null;
  const takenList = [...takenMonths].sort((a, b) => a - b).map((item) => monthName(item));

  function changeYear(next: number) {
    setYear(next);
    setError(null);
    if (Number.isInteger(next) && next >= 2000) {
      const taken = takenMonthsOfYear(projects, brandId, next);
      // Seçili ay yeni yılda doluysa ilk boş aya geç; hepsi doluysa seçim olduğu gibi kalır (form kapalı).
      if (taken.has(month)) setMonth(firstFreeMonth(taken, month) ?? month);
    }
  }

  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (blocked) {
          setError(fieldMessage ?? (loading ? "Mevcut planlar yükleniyor; lütfen bekleyin." : "Geçerli bir ay ve yıl seçin."));
          return;
        }
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
        <select
          aria-label="Ay"
          value={month}
          aria-invalid={existing ? true : undefined}
          aria-describedby={fieldMessage ? "plan-month-error" : undefined}
          onChange={(event) => {
            setMonth(Number(event.target.value));
            setError(null);
          }}
          className="mt-1.5 block h-9 w-44 rounded-lg border border-slate-200 bg-white px-2 text-sm outline-none focus:border-sky-600"
        >
          {Array.from({ length: 12 }, (_, index) => index + 1).map((item) => (
            <option key={item} value={item} disabled={takenMonths.has(item)}>
              {monthName(item)}
              {takenMonths.has(item) ? " (plan var)" : ""}
            </option>
          ))}
        </select>
      </label>
      <label className="text-sm text-neutral-600">
        Yıl
        <input
          aria-label="Yıl"
          type="number"
          min={2000}
          value={year}
          onChange={(event) => changeYear(Number(event.target.value))}
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
        disabled={blocked}
        className="h-9 rounded-lg bg-neutral-900 px-3 text-sm font-medium text-white hover:bg-neutral-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600 disabled:cursor-not-allowed disabled:bg-neutral-300 disabled:hover:bg-neutral-300"
      >
        Oluştur
      </button>
      {loading ? (
        <p role="status" className="w-full text-sm text-neutral-500">
          Mevcut planlar yükleniyor…
        </p>
      ) : null}
      {takenList.length > 0 ? (
        <p className="w-full text-xs text-neutral-500">
          {year} için planı olan aylar: {takenList.join(", ")}.
          {allTaken ? " Bu yılın tüm ayları için plan mevcut; başka bir yıl seçin." : ""}
        </p>
      ) : null}
      {fieldMessage ? (
        <p id="plan-month-error" role="alert" className="w-full text-sm text-red-700">
          {fieldMessage}
        </p>
      ) : null}
      {error && error !== fieldMessage ? (
        <p role="alert" className="w-full text-sm text-red-700">
          {error}
        </p>
      ) : null}
    </form>
  );
}
