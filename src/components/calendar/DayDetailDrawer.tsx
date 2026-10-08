"use client";

import {
  ArrowTopRightOnSquareIcon,
  CheckCircleIcon,
  ClockIcon,
  ExclamationTriangleIcon,
  PaperClipIcon,
  PlusIcon,
  TrashIcon,
  XMarkIcon,
} from "@heroicons/react/20/solid";

import { useEscapeClose, useFocusTrap } from "@/hooks/use-focus-trap";
import {
  formatTime,
  formatWeekdayLong,
  formatDayLong,
  isToday,
} from "@/lib/calendar-utils";
import {
  ITEM_TYPE_META,
  type CalendarItem,
} from "@/lib/calendar-types";
import type { LinkResolution } from "@/lib/calendar-link";
import StatusBadge from "./StatusBadge";

// Not: bu dosya bildirim/hatırlatma UI’sünden arındırıldı.
// Hatırlatma kısmı kaldırıldı; sadece planlama/çizim tarafı kaldı.

/**
 * Gün detayı drawer/modal (§10/§18/§20/§37).
 *
 * - Masaüstünde sağ drawer; mobilde alt sheet.
 * - [+ İçerik Ekle][+ Not Ekle][+ Görev Ekle].
 * - Kayıt: saat + tür + başlık + durum + checklist ileri.
 * - Bağlı Grid içeriği çözümlemesi; silinmişse
 *   "Bağlı içerik bulunamadı" + sil/yeniden bağla (§37).
 * - "Grid Planner'da Aç" (§15).
 * - Escape kapatma + focus trap (§42 a11y).
 */
export default function DayDetailDrawer({
  date,
  items,
  thumbnails,
  resolveLink,
  onClose,
  onAdd,
  onEdit,
  onDelete,
  onToggleChecklist,
  onOpenInPlanner,
}: {
  date: Date;
  /** O günün kayıtları (zaman sıralı). */
  items: CalendarItem[];
  thumbnails: Map<string, string>;
  /** Kaydın postId'sini çözer (§13/§15/§37). */
  resolveLink: (item: CalendarItem) => LinkResolution;
  onClose: () => void;
  onAdd: (itemType: "post" | "note" | "task") => void;
  onEdit: (item: CalendarItem) => void;
  onDelete: (item: CalendarItem) => void;
  onToggleChecklist: (itemId: string, checklistItemId: string) => void;
  onOpenInPlanner: (item: CalendarItem) => void;
}) {
  const drawerRef = useFocusTrap<HTMLDivElement>(true);
  useEscapeClose(true, onClose);

  const today = isToday(date);
  const doneCount = (item: CalendarItem) =>
    item.checklist.filter((entry) => entry.done).length;
  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-labelledby="day-drawer-title">
      <div
        className="absolute inset-0 bg-black/40 animate-dialog-in"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={drawerRef}
        className="animate-drawer-in absolute inset-x-0 bottom-0 flex max-h-[88vh] flex-col rounded-t-2xl bg-white shadow-2xl sm:inset-y-0 sm:right-0 sm:left-auto sm:mt-0 sm:w-[26rem] sm:rounded-none"
      >
        {/* Başlık çubuğu */}
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div className="min-w-0">
            <h2
              id="day-drawer-title"
              className="text-base font-semibold text-neutral-900"
            >
              {formatWeekdayLong(date)}
            </h2>
            <p className="mt-0.5 text-sm text-neutral-500">
              {formatDayLong(date)}
              {today ? " · Bugün" : ""} · {items.length} planlama
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Kapat"
            className="grid size-9 shrink-0 place-items-center rounded-lg text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
          >
            <XMarkIcon className="size-5" aria-hidden="true" />
          </button>
        </div>

        {/* Hızlı ekleme (§10/§18) */}
        <div className="grid grid-cols-3 gap-2 border-b border-slate-200 px-5 py-3">
          {(
            [
              { type: "post" as const, label: "+ İçerik Ekle" },
              { type: "note" as const, label: "+ Not Ekle" },
              { type: "task" as const, label: "+ Görev Ekle" },
            ]
          ).map((action) => (
            <button
              key={action.type}
              type="button"
              onClick={() => onAdd(action.type)}
              className="inline-flex h-9 items-center justify-center gap-1 rounded-lg border border-slate-200 bg-white px-2 text-xs font-medium text-neutral-700 hover:border-sky-300 hover:bg-sky-50/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
            >
              <PlusIcon className="size-3.5 shrink-0 text-sky-700" aria-hidden="true" />
              <span className="truncate">{action.label}</span>
            </button>
          ))}
        </div>

        {/* Kayıt listesi */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
          {items.length === 0 ? (
            <div className="grid h-full place-items-center py-10 text-center">
              <div>
                <ClockIcon className="mx-auto mb-2 size-6 text-neutral-300" aria-hidden="true" />
                <p className="text-sm font-medium text-neutral-500">
                  Bu gün için planlama yok.
                </p>
                <p className="mt-1 text-xs text-neutral-400">
                  Yukarıdaki butonlarla içerik, not veya görev ekleyin.
                </p>
              </div>
            </div>
          ) : (
            <ul className="space-y-2.5">
              {items.map((item) => {
                const type = ITEM_TYPE_META[item.itemType];
                const thumbnail = item.postId
                  ? thumbnails.get(item.postId)
                  : undefined;
                const link = resolveLink(item);
                const done = doneCount(item);
                return (
                  <DayItem
                    key={item.id}
                    item={item}
                    typeLabel={type.label}
                    thumbnailUrl={thumbnail}
                    link={link}
                    done={done}
                    onEdit={() => onEdit(item)}
                    onDelete={() => onDelete(item)}
                    onToggleChecklist={(checklistItemId) =>
                      onToggleChecklist(item.id, checklistItemId)
                    }
                    onOpenInPlanner={() => onOpenInPlanner(item)}
                  />
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function DayItem({
  item,
  typeLabel,
  thumbnailUrl,
  link,
  done,
  onEdit,
  onDelete,
  onToggleChecklist,
  onOpenInPlanner,
}: {
  item: CalendarItem;
  typeLabel: string;
  thumbnailUrl?: string;
  link: LinkResolution;
  done: number;
  onEdit: () => void;
  onDelete: () => void;
  onToggleChecklist: (checklistItemId: string) => void;
  onOpenInPlanner: () => void;
}) {
  const missing = link.status === "missing";
  const cancelled = item.status === "cancelled";

  return (
    <li
      className={`rounded-xl border border-slate-200 bg-white p-3 shadow-sm ${
        cancelled ? "opacity-70" : ""
      }`}
    >
      <div className="flex items-start gap-2.5">
        {thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={thumbnailUrl}
            alt=""
            className="mt-0.5 size-9 shrink-0 rounded-lg object-cover"
            draggable={false}
          />
        ) : (
          <span
            className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-500"
            aria-hidden="true"
          >
            {item.itemType === "note" ? (
              <PaperClipIcon className="size-4" />
            ) : (
              <ClockIcon className="size-4" />
            )}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold tabular-nums text-neutral-700">
              {formatTime(item.scheduledAt)}
            </span>
            <span className="text-[11px] font-medium text-neutral-400">
              {typeLabel}
            </span>
          </div>
          <p className="mt-0.5 text-sm font-semibold text-neutral-900">
            {item.title}
          </p>
          {item.description ? (
            <p className="mt-0.5 line-clamp-2 text-xs text-neutral-500">
              {item.description}
            </p>
          ) : null}
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <StatusBadge status={item.status === "planned" && new Date(item.scheduledAt).getTime() < Date.now() ? "overdue" : item.status} />
            {item.checklist.length > 0 ? (
              <span className="rounded-full bg-neutral-100 px-1.5 py-0.5 text-[10px] font-medium text-neutral-500">
                {done}/{item.checklist.length} checklist
              </span>
            ) : null}
          </div>
        </div>
      </div>

      {/* Checklist (§20) — kalıcı durum, anında kaydedilir */}
      {item.checklist.length > 0 ? (
        <ul className="mt-2 space-y-1 border-t border-slate-100 pt-2">
          {item.checklist.map((entry) => (
            <li key={entry.id} className="flex items-center gap-2">
              <input
                id={`drawer-checklist-${item.id}-${entry.id}`}
                type="checkbox"
                checked={entry.done}
                onChange={() => onToggleChecklist(entry.id)}
                className="size-3.5 shrink-0 accent-sky-700"
              />
              <label
                htmlFor={`drawer-checklist-${item.id}-${entry.id}`}
                className={`min-w-0 flex-1 truncate text-xs ${
                  entry.done
                    ? "text-neutral-400 line-through"
                    : "text-neutral-700"
                }`}
              >
                {entry.label}
              </label>
            </li>
          ))}
        </ul>
      ) : null}

      {/* Bağlı Grid içeriği (§13/§15/§37) */}
      {item.postId ? (
        link.status === "ok" ? (
          <div className="mt-2 flex items-center gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5">
            <CheckCircleIcon className="size-4 shrink-0 text-emerald-600" aria-hidden="true" />
            <p className="min-w-0 flex-1 truncate text-xs text-neutral-600">
              Grid Planner içeriği: {link.link.post.caption?.trim() || link.link.post.alt || "Başlıksız"}
            </p>
            <button
              type="button"
              onClick={onOpenInPlanner}
              className="inline-flex shrink-0 items-center gap-1 rounded-md bg-white px-2 py-1 text-[11px] font-medium text-sky-700 ring-1 ring-slate-200 hover:bg-sky-50 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-600"
              aria-label={`Grid Planner'da aç: ${item.title}`}
            >
              Grid Planner'da Aç
              <ArrowTopRightOnSquareIcon className="size-3" aria-hidden="true" />
            </button>
          </div>
        ) : (
          <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5">
            <div className="flex items-center gap-1.5">
              <ExclamationTriangleIcon className="size-4 shrink-0 text-amber-600" aria-hidden="true" />
              <p className="text-xs font-semibold text-amber-800">
                Bağlı içerik bulunamadı
              </p>
            </div>
            <p className="mt-0.5 text-[11px] text-amber-700">
              Grid Planner içeriği silinmiş. Kaydı silin veya yeni bir içerik bağlayın.
            </p>
            <div className="mt-1.5 flex gap-1.5">
              <button
                type="button"
                onClick={onEdit}
                className="h-7 rounded-md bg-white px-2 text-[11px] font-medium text-sky-700 ring-1 ring-slate-200 hover:bg-sky-50 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-600"
              >
                Yeniden bağla
              </button>
              <button
                type="button"
                onClick={onDelete}
                className="inline-flex h-7 items-center gap-1 rounded-md bg-white px-2 text-[11px] font-medium text-red-600 ring-1 ring-red-200 hover:bg-red-50 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-red-600"
              >
                <TrashIcon className="size-3" aria-hidden="true" />
                Kaydı sil
              </button>
            </div>
          </div>
        )
      ) : null}

      {/* Kayıt işlemleri */}
      <div className="mt-2 flex items-center justify-end gap-1.5 border-t border-slate-100 pt-2">
        <button
          type="button"
          onClick={onEdit}
          className="h-7 rounded-md px-2 text-[11px] font-medium text-neutral-600 hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-600"
        >
          Düzenle
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11px] font-medium text-red-600 hover:bg-red-50 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-red-600"
          aria-label={`Sil: ${item.title}`}
        >
          <TrashIcon className="size-3" aria-hidden="true" />
          Sil
        </button>
      </div>
    </li>
  );
}
