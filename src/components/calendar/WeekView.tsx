import { useDroppable } from "@dnd-kit/core";

import {
  buildWeekColumns,
  DAY_VIEW_HOURS,
  DAY_VIEW_START_HOUR,
  formatTime,
  isToday,
  itemsForDay,
  WEEKDAY_LABELS,
} from "@/lib/calendar-utils";
import type { CalendarItem } from "@/lib/calendar-types";
import CalendarItemCard from "./CalendarItemCard";

function slotId(date: Date, hour: number): string {
  return `week-slot-${date.getFullYear()}-${date.getMonth()}-${date.getDate()}-${hour}`;
}

/**
 * Hafta görünümü (§17): 7 gün × saat dilimi (08:00–23:00).
 *
 * Her saat hücresi sürüklenebilir alan (droppable):
 * kart buraya sürüklendiğinde tarih+saat değişir (§21).
 * Mobilde yatay kaydırma.
 */
export default function WeekView({
  anchor,
  items,
  thumbnails,
  onSelectDay,
  onOpenItem,
}: {
  /** Haftanın herhangi bir günü (Pzt başlangıcı hesaplanır). */
  anchor: Date;
  items: CalendarItem[];
  thumbnails: Map<string, string>;
  onSelectDay: (date: Date) => void;
  onOpenItem: (item: CalendarItem) => void;
}) {
  const columns = buildWeekColumns(items, anchor);
  const today = new Date();

  return (
    <div className="animate-calendar-enter overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <div
        className="grid min-w-[860px] grid-cols-[3.5rem_repeat(7,minmax(0,1fr))]"
        role="grid"
        aria-label="Hafta görünümü"
      >
        {/* Köşe + gün başlıkları */}
        <div className="border-b border-slate-200" role="columnheader" aria-hidden="true" />
        {columns.map((column) => {
          const date = column.date;
          const dayCount = itemsForDay(items, date).length;
          return (
            <button
              key={date.toISOString()}
              type="button"
              role="columnheader"
              onClick={() => onSelectDay(date)}
              className={`border-b border-l border-slate-200 px-2 py-2 text-center first:border-l-0 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-sky-600 ${
                column.isToday
                  ? "bg-sky-50/70"
                  : column.isWeekend
                    ? "bg-slate-50/50"
                    : ""
              }`}
              aria-label={`${WEEKDAY_LABELS[(date.getDay() + 6) % 7]} ${date.getDate()} ${date.toLocaleDateString("tr-TR", { month: "long" })}, gün detayı için aç${dayCount > 0 ? `, ${dayCount} planlama` : ""}`}
            >
              <span className="block text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                {WEEKDAY_LABELS[(date.getDay() + 6) % 7]}
              </span>
              <span
                className={`mx-auto mt-0.5 grid size-6 place-items-center rounded-full text-xs font-semibold tabular-nums ${
                  column.isToday
                    ? "bg-sky-700 text-white"
                    : "text-neutral-800"
                }`}
              >
                {date.getDate()}
              </span>
            </button>
          );
        })}

        {/* Saat satırları */}
        {DAY_VIEW_HOURS.map((hour) => (
          <div
            key={hour}
            className="contents"
            role="row"
            aria-label={`${String(hour).padStart(2, "0")}:00`}
          >
            <div className="border-b border-slate-100 pr-1.5 pt-1 text-right text-[10px] font-medium tabular-nums text-neutral-400">
              {String(hour).padStart(2, "0")}:00
            </div>
            {columns.map((column) => (
              <WeekSlot
                key={`${column.date.toISOString()}-${hour}`}
                date={column.date}
                hour={hour}
                items={
                  column.slots[hour - DAY_VIEW_START_HOUR]?.items ?? []
                }
                thumbnails={thumbnails}
                onOpenItem={onOpenItem}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function WeekSlot({
  date,
  hour,
  items,
  thumbnails,
  onOpenItem,
}: {
  date: Date;
  hour: number;
  items: CalendarItem[];
  thumbnails: Map<string, string>;
  onOpenItem: (item: CalendarItem) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: slotId(date, hour),
    data: {
      date: new Date(date.getFullYear(), date.getMonth(), date.getDate()).toISOString(),
      hour,
      view: "week",
    },
  });

  return (
    <div
      ref={setNodeRef}
      role="gridcell"
      aria-label={`${date.toLocaleDateString("tr-TR", { weekday: "long" })} ${String(hour).padStart(2, "0")}:00${items.length > 0 ? `, ${items.length} planlama` : ""}`}
      className={`min-h-[3.25rem] border-b border-l border-slate-100 p-0.5 first:border-l-0 ${
        isOver ? "bg-sky-100/70 ring-2 ring-dashed ring-inset ring-sky-400" : ""
      } ${isToday(date) ? "bg-sky-50/30" : ""}`}
    >
      {items.map((item) => (
        <CalendarItemCard
          key={item.id}
          item={item}
          thumbnailUrl={item.postId ? thumbnails.get(item.postId) : undefined}
          onOpen={onOpenItem}
        />
      ))}
      {items.length > 0 ? (
        <span className="sr-only">
          {items.map((item) => `${formatTime(item.scheduledAt)} ${item.title}`).join(", ")}
        </span>
      ) : null}
    </div>
  );
}
