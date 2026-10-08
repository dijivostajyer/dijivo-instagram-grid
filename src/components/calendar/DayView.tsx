import { useDroppable } from "@dnd-kit/core";

import {
  DAY_VIEW_HOURS,
  formatTime,
  groupByHour,
  isToday,
} from "@/lib/calendar-utils";
import type { CalendarItem } from "@/lib/calendar-types";
import CalendarItemCard from "./CalendarItemCard";

/**
 * Gün görünümü (§16): 08:00–23:00 saat çizelgesi.
 *
 * Her saat dilimi sürüklenebilir alan (droppable):
 * kart buraya sürüklendiğinde saati değişir (§21).
 * Bugün görünürse "şimdi" işareti çizilir.
 */
export default function DayView({
  date,
  items,
  thumbnails,
  onOpenItem,
}: {
  date: Date;
  items: CalendarItem[];
  thumbnails: Map<string, string>;
  onOpenItem: (item: CalendarItem) => void;
}) {
  const slots = groupByHour(items);
  const now = new Date();
  const showNow = isToday(date, now);
  const nowPosition =
    now.getHours() >= 8 && now.getHours() < 24
      ? (now.getHours() - 8 + now.getMinutes() / 60) * 100 / 16
      : null;

  return (
    <div
      className="animate-calendar-enter overflow-hidden rounded-xl border border-slate-200 bg-white"
      role="grid"
      aria-label={`${date.toLocaleDateString("tr-TR", { dateStyle: "long" })} gün görünümü`}
    >
      {DAY_VIEW_HOURS.map((hour) => {
        const slot = slots[hour - 8];
        return (
          <DayHourRow
            key={hour}
            date={date}
            hour={hour}
            items={slot?.items ?? []}
            thumbnails={thumbnails}
            showNow={showNow && hour === now.getHours()}
            nowLabel={formatTime(now.toISOString())}
            onOpenItem={onOpenItem}
          />
        );
      })}
      {showNow && nowPosition !== null ? (
        <div
          className="pointer-events-none absolute inset-x-0"
          style={{ top: `${nowPosition}%` }}
          aria-hidden="true"
        >
          <div className="relative border-t-2 border-rose-500">
            <span className="absolute -top-1 right-2 rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-semibold text-white">
              Şimdi
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function DayHourRow({
  date,
  hour,
  items,
  thumbnails,
  showNow,
  nowLabel,
  onOpenItem,
}: {
  date: Date;
  hour: number;
  items: CalendarItem[];
  thumbnails: Map<string, string>;
  showNow: boolean;
  nowLabel: string;
  onOpenItem: (item: CalendarItem) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `day-slot-${hour}`,
    data: {
      date: new Date(date.getFullYear(), date.getMonth(), date.getDate()).toISOString(),
      hour,
      view: "day",
    },
  });

  return (
    <div
      className={`grid grid-cols-[3.5rem_minmax(0,1fr)] border-b border-slate-100 last:border-b-0 ${
        isOver ? "bg-sky-100/70" : ""
      }`}
      role="row"
    >
      <div className="border-r border-slate-100 pr-1.5 pt-1 text-right text-[10px] font-medium tabular-nums text-neutral-400">
        {String(hour).padStart(2, "0")}:00
      </div>
      <div
        ref={setNodeRef}
        role="gridcell"
        aria-label={`${String(hour).padStart(2, "0")}:00${items.length > 0 ? `, ${items.length} planlama` : ""}${showNow ? `, şimdi ${nowLabel}` : ""}`}
        className="relative min-h-[4rem] p-0.5"
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
    </div>
  );
}
