import { useDroppable } from "@dnd-kit/core";

import {
  buildMonthMatrix,
  formatDayLong,
  isPastDay,
  isToday,
  isWeekend,
  itemsForDay,
  MONTH_LABELS,
  WEEKDAY_LABELS,
} from "@/lib/calendar-utils";
import type { CalendarItem } from "@/lib/calendar-types";
import CalendarItemCard from "./CalendarItemCard";

const MAX_VISIBLE = 3;

function dayId(date: Date): string {
  return `month-day-${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

/**
 * Ay görünümü (§4/§5/§6).
 *
 * - Pzt–Paz başlıklı profesyonel grid.
 * - Gün hücresi: numero + kartlar (max 3) + "+N içerik".
 * - Bugün: ince vurgu çerçevesi + hafif glow + badge (neon yok).
 * - Geçmiş gün: soluk ama okunabilir; hafta sonu: hafif tint;
 *   başka aya ait günler muted.
 */
export default function MonthView({
  year,
  month,
  items,
  thumbnails,
  onSelectDay,
  onOpenItem,
}: {
  year: number;
  /** 1–12 */
  month: number;
  items: CalendarItem[];
  /** postId → thumbnail (başlı Grid içeriği, §9) */
  thumbnails: Map<string, string>;
  onSelectDay: (date: Date) => void;
  onOpenItem: (item: CalendarItem) => void;
}) {
  const weeks = buildMonthMatrix(year, month);
  const today = new Date();

  return (
    <div
      className="animate-calendar-enter rounded-xl border border-slate-200 bg-white"
      role="grid"
      aria-label={`${MONTH_LABELS[month - 1]} ${year} ay görünümü`}
    >
      {/* Hafta başlıkları (§4) */}
      <div
        className="grid grid-cols-7 border-b border-slate-200"
        role="row"
      >
        {WEEKDAY_LABELS.map((label, index) => (
          <div
            key={label}
            role="columnheader"
            className={`px-2 py-2 text-center text-xs font-semibold uppercase tracking-wide ${
              index >= 5 ? "text-slate-400" : "text-neutral-500"
            }`}
          >
            {label}
          </div>
        ))}
      </div>

      {weeks.map((week, weekIndex) => (
        <div
          key={weekIndex}
          className="grid grid-cols-7 border-b border-slate-100 last:border-b-0"
          role="row"
        >
          {week.map((day) => {
            const date = day.date;
            const dayItems = itemsForDay(items, date);
            const todayFlag = isToday(date, today);
            const past = isPastDay(date, today);
            const weekend = isWeekend(date);
            const visible = dayItems.slice(0, MAX_VISIBLE);
            const overflow = dayItems.length - visible.length;
            return (
              <MonthDayCell
                key={date.toISOString()}
                id={dayId(date)}
                date={date}
                inMonth={day.inMonth}
                today={todayFlag}
                past={past}
                weekend={weekend}
                count={dayItems.length}
                onSelect={onSelectDay}
                onOpenItem={onOpenItem}
              >
                {visible.map((item) => (
                  <CalendarItemCard
                    key={item.id}
                    item={item}
                    thumbnailUrl={item.postId ? thumbnails.get(item.postId) : undefined}
                    onOpen={onOpenItem}
                  />
                ))}
                {overflow > 0 ? (
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onSelectDay(date);
                    }}
                    className="mb-1 w-full rounded-md px-1.5 py-0.5 text-left text-[11px] font-medium text-sky-700 hover:bg-sky-50 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-600"
                    aria-label={`${formatDayLong(date)} günündeki diğer ${overflow} içerik`}
                  >
                    +{overflow} içerik
                  </button>
                ) : null}
              </MonthDayCell>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function MonthDayCell({
  id,
  date,
  inMonth,
  today,
  past,
  weekend,
  count,
  onSelect,
  onOpenItem,
  children,
}: {
  id: string;
  date: Date;
  inMonth: boolean;
  today: boolean;
  past: boolean;
  weekend: boolean;
  count: number;
  onSelect: (date: Date) => void;
  onOpenItem: (item: CalendarItem) => void;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id,
    data: { date: date.toISOString(), view: "month" },
  });

  return (
    <div
      ref={setNodeRef}
      role="gridcell"
      aria-label={`${formatDayLong(date)}${count > 0 ? `, ${count} planlama` : ""}${today ? ", bugün" : ""}`}
      onClick={() => onSelect(date)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          onSelect(date);
        }
      }}
      tabIndex={0}
      className={`min-h-[7.5rem] cursor-pointer p-1.5 transition focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-sky-600 sm:min-h-[8.5rem] ${
        // §5: bugününkü hücre — ince vurgu çerçevesi + soft glow.
        today
          ? "animate-today-glow ring-1 ring-sky-500 ring-offset-1"
          : ""
      } ${
        weekend && !today ? "bg-slate-50/70" : "bg-white"
      } ${
        // Geçmiş gün: soluk ama kontrast korunur.
        past && !today ? "opacity-70" : ""
      } ${
        // Başka aya ait gün: muted.
        !inMonth ? "bg-slate-50/40 text-neutral-400" : ""
      } ${
        isOver ? "bg-sky-100/70 ring-2 ring-dashed ring-sky-400" : ""
      }`}
    >
      <div className="mb-1 flex items-center justify-between px-0.5">
        <span
          className={`text-xs font-medium tabular-nums ${
            today
              ? "grid size-6 place-items-center rounded-full bg-sky-700 text-white"
              : inMonth
                ? "text-neutral-700"
                : "text-neutral-400"
          }`}
        >
          {date.getDate()}
        </span>
        {today ? (
          <span className="rounded-full bg-sky-50 px-1.5 py-0.5 text-[10px] font-semibold text-sky-700 ring-1 ring-sky-200">
            Bugün
          </span>
        ) : count > 0 ? (
          <span
            className="text-[10px] font-medium tabular-nums text-neutral-400"
            aria-hidden="true"
          >
            {count}
          </span>
        ) : null}
      </div>
      <div onClick={(event) => event.stopPropagation()}>{children}</div>
    </div>
  );
}
