"use client";

import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  ArrowTopRightOnSquareIcon,
  CalendarDaysIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  PlusIcon,
} from "@heroicons/react/20/solid";
import { useEffect, useMemo, useRef, useState } from "react";

import type { AppView } from "@/components/AppSidebar";
import DayDetailDrawer from "@/components/calendar/DayDetailDrawer";
import DayView from "@/components/calendar/DayView";
import MonthView from "@/components/calendar/MonthView";
import PlanningForm from "@/components/calendar/PlanningForm";
import WeekView from "@/components/calendar/WeekView";
import {
  buildLinkedPostOptions,
  resolveCalendarLink,
} from "@/lib/calendar-link";
import {
  computeDraggedScheduledAt,
  filterByProject,
  formatDayLong,
  isSameDay,
  isToday,
  itemsForDay,
  MONTH_LABELS,
  startOfWeek,
  toggleChecklistItem,
  type DragTarget,
} from "@/lib/calendar-utils";
import type {
  CalendarItem,
  CalendarItemType,
} from "@/lib/calendar-types";
import type {
  CalendarItemInput,
  CalendarPatch,
} from "@/lib/calendar-store";
import type { CalendarLoadState } from "@/hooks/use-calendar-store";
import type { GridProject } from "@/lib/storage";
import { monthLabel } from "@/lib/project-ops";

/** Görünüm modları (§4/§16/§17). */
export type CalendarViewMode = "month" | "week" | "day";

interface CalendarViewProps {
  brandId: string;
  brandName: string;
  activeProjectId: string;
  /** Aktif markanın aylık planları (§25 ay→proje çözümlemesi). */
  projects: GridProject[];
  /** Tüm markaların projeleri (bağlantı çözümlemesi + thumbnails). */
  allProjects: GridProject[];
  /** Aktif markanın TÜM takvim kayıtları (§24: proje filtresi burada). */
  brandItems: CalendarItem[];
  loadState: CalendarLoadState;
  storeReady: boolean;
  saving: boolean;
  onRefresh: () => Promise<void>;
  onCreateItem: (input: CalendarItemInput) => Promise<CalendarItem | null>;
  onUpdateItem: (
    id: string,
    patch: CalendarPatch,
  ) => Promise<CalendarItem | null>;
  onRemoveItem: (id: string) => Promise<boolean>;
  /** §15: kaydın bağlı Grid Planner içeriğini açar. */
  onOpenItemInPlanner: (item: CalendarItem) => void;
  /** Araç çubuğu "Grid Planner'da Aç": görünen aylık planı açar. */
  onOpenPlanner: (projectId: string) => void;
  onNavigate: (view: AppView) => void;
}

function weekRangeLabel(anchor: Date): string {
  const start = startOfWeek(anchor);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  if (
    start.getMonth() === end.getMonth() &&
    start.getFullYear() === end.getFullYear()
  ) {
    return `${start.getDate()}–${end.getDate()} ${MONTH_LABELS[start.getMonth()]} ${start.getFullYear()}`;
  }
  return `${formatDayLong(start)} – ${formatDayLong(end)}`;
}

/**
 * İçerik Takvimi (§4–§25): ay/hafta/gün görünümleri,
 * sürükle-bırak, gün detayı drawer ve planlama formu.
 *
 * §25: ay navigasyonunda görüntülenen aya ait aylık
 * plan seçilir; plan yoksa boş durum gösterilir —
 * hiçbir zaman başka projenin verisi görünmez ve
 * otomatik proje oluşturulmaz.
 */
export default function CalendarView({
  brandId,
  brandName,
  activeProjectId,
  projects,
  allProjects,
  brandItems,
  loadState,
  storeReady,
  saving,
  onRefresh,
  onCreateItem,
  onUpdateItem,
  onRemoveItem,
  onOpenItemInPlanner,
  onOpenPlanner,
  onNavigate,
}: CalendarViewProps) {
  const [viewMode, setViewMode] = useState<CalendarViewMode>("month");
  // Görünen dönemin çapası: ayda yıl+ay, hafta/günde tarih.
  const [anchor, setAnchor] = useState<Date>(() => {
    const project = projects.find((item) => item.id === activeProjectId);
    if (project) return new Date(project.year, project.month - 1, 15);
    return new Date();
  });
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<CalendarItem | null>(null);
  const [defaultDate, setDefaultDate] = useState<Date | null>(null);
  const [defaultItemType, setDefaultItemType] =
    useState<CalendarItemType | null>(null);

  // Dışarıdan proje seçimi (Planı Aç, topbar) → görünen
  // dönem o projenin ayına senkronize olur. Takvim
  // navigasyonu yalnızca `anchor` değiştirdiğinden
  // geri bildirim döngüsü oluşmaz.
  const prevProjectRef = useRef(activeProjectId);
  useEffect(() => {
    if (prevProjectRef.current === activeProjectId) return;
    prevProjectRef.current = activeProjectId;
    const project = projects.find((item) => item.id === activeProjectId);
    if (project) {
      setAnchor(new Date(project.year, project.month - 1, 15));
    }
  }, [activeProjectId, projects]);

  // §25: görünen aya ait aylık plan. Yoksa boş durum.
  const displayedProject = useMemo(
    () =>
      projects.find(
        (item) =>
          item.month === anchor.getMonth() + 1 &&
          item.year === anchor.getFullYear(),
      ) ?? null,
    [projects, anchor],
  );

  // §23/§24: yalnızca görünen projenin kayıtları (marka
  // izolasyonu hook katmanında zaten sağlanmıştı).
  const visibleItems = useMemo(
    () =>
      displayedProject
        ? filterByProject(brandItems, brandId, displayedProject.id)
        : [],
    [brandItems, brandId, displayedProject],
  );

  // §9: Grid Planner gönderilerinin thumbnailleri
  // (hidrated blob: URL'ler).
  const thumbnails = useMemo(() => {
    const map = new Map<string, string>();
    for (const project of allProjects) {
      for (const post of [...project.existingPosts, ...project.plannedPosts]) {
        if (post.imageUrl) map.set(post.id, post.imageUrl);
      }
    }
    return map;
  }, [allProjects]);

  const linkedOptions = useMemo(
    () => buildLinkedPostOptions(allProjects, brandId),
    [allProjects, brandId],
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  // §21: sürükleme sonucu tarih (ay görünümü) veya
  // tarih+saat (hafta/gün görünümü) değişir. Kayıt
  // aynı projede kalır; optimistic güncelleme + rollback
  // hook tarafından yapılır (§36).
  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over) return;
    const itemId = active.data.current?.itemId as string | undefined;
    const target = over.data.current as
      | { date?: string; hour?: number }
      | undefined;
    if (!itemId || !target) return;
    const item = visibleItems.find((current) => current.id === itemId);
    if (!item) return;
    const dragTarget: DragTarget = {};
    if (target.date) dragTarget.date = new Date(target.date);
    if (typeof target.hour === "number") dragTarget.hour = target.hour;
    const next = computeDraggedScheduledAt(item, dragTarget);
    if (next !== item.scheduledAt) {
      void onUpdateItem(item.id, { scheduledAt: next });
    }
  }

  function navigate(direction: -1 | 1) {
    setAnchor((current) => {
      const next = new Date(current);
      if (viewMode === "month") {
        next.setMonth(next.getMonth() + direction);
      } else if (viewMode === "week") {
        next.setDate(next.getDate() + direction * 7);
      } else {
        next.setDate(next.getDate() + direction);
      }
      return next;
    });
  }

  function goToday() {
    setAnchor(new Date());
  }

  function openDay(date: Date) {
    setSelectedDay(date);
  }

  function openItemEditor(item: CalendarItem) {
    setEditing(item);
    setFormOpen(true);
  }

  function openCreator(type: CalendarItemType | null, day: Date) {
    setEditing(null);
    setDefaultItemType(type);
    // Varsayılan saat: bugün ise şimdi, geçmiş/gelecek günse 09:00.
    const withTime = new Date(day);
    if (isSameDay(day, new Date())) {
      withTime.setTime(new Date().getTime());
    } else {
      withTime.setHours(9, 0, 0, 0);
    }
    setDefaultDate(withTime);
    setFormOpen(true);
  }

  async function handleSubmit(
    input: CalendarItemInput,
    editingId: string | null,
  ): Promise<boolean> {
    if (editingId) {
      const patch: CalendarPatch = {
        postId: input.postId,
        itemType: input.itemType,
        title: input.title,
        description: input.description,
        scheduledAt: input.scheduledAt,
        status: input.status,
        reminderOffsetMinutes: input.reminderOffsetMinutes,
        checklist: input.checklist,
      };
      return (await onUpdateItem(editingId, patch)) !== null;
    }
    // §24: yeni kayıt görünen aylık plana aittir.
    if (!displayedProject) return false;
    return (
      (await onCreateItem({ ...input, projectId: displayedProject.id })) !==
      null
    );
  }

  async function handleDelete(item: CalendarItem) {
    await onRemoveItem(item.id);
    setFormOpen(false);
  }

  function handleToggleChecklist(itemId: string, checklistItemId: string) {
    const item = visibleItems.find((current) => current.id === itemId);
    if (!item) return;
    void onUpdateItem(item.id, {
      checklist: toggleChecklistItem(item.checklist, checklistItemId),
    });
  }

  const periodLabel =
    viewMode === "month"
      ? `${MONTH_LABELS[anchor.getMonth()]} ${anchor.getFullYear()}`
      : viewMode === "week"
        ? weekRangeLabel(anchor)
        : formatDayLong(anchor);

  const loading = !storeReady || loadState === "loading";

  return (
    <div className="mx-auto max-w-[1400px]">
      {/* Başlık (§1) */}
      <div className="mb-5">
        <h2 className="text-2xl font-semibold tracking-tight text-neutral-900">
          İçerik Takvimi
        </h2>
        <p className="mt-1 truncate text-sm text-neutral-600">
          {brandName} ·{" "}
          {displayedProject
            ? `${displayedProject.name} · ${monthLabel(displayedProject.month, displayedProject.year)}`
            : "Bu ay için aylık plan yok"}
        </p>
      </div>

      {/* Araç çubuğu (§3/§4/§16/§17) */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => navigate(-1)}
            aria-label="Önceki"
            className="grid size-9 place-items-center rounded-lg border border-slate-200 bg-white text-neutral-600 hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
          >
            <ChevronLeftIcon className="size-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={goToday}
            className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-neutral-700 hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
          >
            Bugün
          </button>
          <button
            type="button"
            onClick={() => navigate(1)}
            aria-label="Sonraki"
            className="grid size-9 place-items-center rounded-lg border border-slate-200 bg-white text-neutral-600 hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
          >
            <ChevronRightIcon className="size-4" aria-hidden="true" />
          </button>
        </div>

        <p className="min-w-36 text-sm font-semibold text-neutral-900 tabular-nums">
          {periodLabel}
        </p>

        {/* Görünüm seçici */}
        <div
          className="flex rounded-lg border border-slate-200 bg-white p-0.5"
          role="tablist"
          aria-label="Takvim görünümü"
        >
          {(
            [
              { value: "month", label: "Ay" },
              { value: "week", label: "Hafta" },
              { value: "day", label: "Gün" },
            ] as const
          ).map((option) => (
            <button
              key={option.value}
              type="button"
              role="tab"
              aria-selected={viewMode === option.value}
              onClick={() => setViewMode(option.value)}
              className={`h-8 rounded-md px-3 text-sm font-medium transition focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-600 ${
                viewMode === option.value
                  ? "bg-neutral-900 text-white"
                  : "text-neutral-600 hover:bg-neutral-50"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {saving ? (
            <span
              className="text-xs font-medium text-sky-700"
              role="status"
              aria-live="polite"
            >
              Kaydediliyor…
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => displayedProject && onOpenPlanner(displayedProject.id)}
            disabled={!displayedProject}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
          >
            <ArrowTopRightOnSquareIcon className="size-4" aria-hidden="true" />
            Grid Planner&rsquo;da Aç
          </button>
          <button
            type="button"
            onClick={() => displayedProject && openCreator(null, anchor)}
            disabled={!displayedProject || loading}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-sky-700 px-3 text-sm font-medium text-white hover:bg-sky-800 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
          >
            <PlusIcon className="size-4" aria-hidden="true" />
            Yeni Planlama
          </button>
        </div>
      </div>

      {/* Yükleme / hata durumları (§36) */}
      {loading ? (
        <div className="grid min-h-72 place-items-center rounded-xl border border-slate-200 bg-white">
          <p className="text-sm text-neutral-500">Yükleniyor…</p>
        </div>
      ) : loadState === "error" ? (
        <div className="grid min-h-72 place-items-center rounded-xl border border-slate-200 bg-white p-8 text-center">
          <div>
            <p className="text-sm font-semibold text-neutral-800">
              Takvim yüklenemedi.
            </p>
            <p className="mt-1 text-sm text-neutral-500">
              Kayıtlar alınırken bir sorun oluştu.
            </p>
            <button
              type="button"
              onClick={() => void onRefresh()}
              className="mt-4 h-9 rounded-lg bg-sky-700 px-4 text-sm font-medium text-white hover:bg-sky-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
            >
              Tekrar dene
            </button>
          </div>
        </div>
      ) : !displayedProject ? (
        /* §25: bu ay için plan yok — boş durum; asla
           otomatik proje oluşturulmaz, başka projenin
           verisi görünmez. */
        <div className="grid min-h-72 place-items-center rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center">
          <div>
            <CalendarDaysIcon
              className="mx-auto mb-3 size-8 text-neutral-300"
              aria-hidden="true"
            />
            <p className="text-base font-semibold text-neutral-800">
              Bu ay için plan bulunamadı.
            </p>
            <p className="mt-1 max-w-sm text-sm text-neutral-500">
              {MONTH_LABELS[anchor.getMonth()]} {anchor.getFullYear()} ayı
              için bir aylık plan oluşturarak içerik planlamaya başlayın.
            </p>
            <button
              type="button"
              onClick={() => onNavigate("plans")}
              className="mt-4 h-9 rounded-lg bg-sky-700 px-4 text-sm font-medium text-white hover:bg-sky-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
            >
              Aylık Plan Oluştur
            </button>
          </div>
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          {viewMode === "month" ? (
            <MonthView
              year={anchor.getFullYear()}
              month={anchor.getMonth() + 1}
              items={visibleItems}
              thumbnails={thumbnails}
              onSelectDay={openDay}
              onOpenItem={openItemEditor}
            />
          ) : null}

          {viewMode === "week" ? (
            <WeekView
              anchor={anchor}
              items={visibleItems}
              thumbnails={thumbnails}
              onSelectDay={openDay}
              onOpenItem={openItemEditor}
            />
          ) : null}

          {viewMode === "day" ? (
            <DayView
              date={anchor}
              items={visibleItems}
              thumbnails={thumbnails}
              onOpenItem={openItemEditor}
            />
          ) : null}
        </DndContext>
      )}

      {/* Gün detayı drawer/modal (§10) */}
      {selectedDay && displayedProject ? (
        <DayDetailDrawer
          date={selectedDay}
          items={itemsForDay(visibleItems, selectedDay)}
          thumbnails={thumbnails}
          resolveLink={(item) =>
            resolveCalendarLink(allProjects, item.postId, brandId)
          }
          onClose={() => setSelectedDay(null)}
          onAdd={(type) => openCreator(type, selectedDay)}
          onEdit={openItemEditor}
          onDelete={handleDelete}
          onToggleChecklist={handleToggleChecklist}
          onOpenInPlanner={onOpenItemInPlanner}
        />
      ) : null}

      {/* Planlama formu (§11/§18/§19) */}
      {formOpen && displayedProject ? (
        <PlanningForm
          brandId={brandId}
          projectId={displayedProject.id}
          initial={editing}
          defaultDate={defaultDate ?? undefined}
          defaultItemType={defaultItemType}
          linkedOptions={linkedOptions}
          saveError={null}
          onSubmit={handleSubmit}
          onClose={() => setFormOpen(false)}
        />
      ) : null}

      {/* Bugün gösterimi için erişilebilir açıklama (§42 a11y) */}
      <p className="sr-only" aria-live="polite">
        {isToday(anchor)
          ? "Bugün"
          : `Görünen dönem: ${periodLabel}`}{" "}
        · {visibleItems.length} planlama
      </p>
    </div>
  );
}
