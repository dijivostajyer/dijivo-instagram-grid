import { useDraggable } from "@dnd-kit/core";
import { CalendarDaysIcon, ClockIcon, PaperClipIcon } from "@heroicons/react/20/solid";

import { deriveStatus, formatTime } from "@/lib/calendar-utils";
import { ITEM_TYPE_META, type CalendarItem } from "@/lib/calendar-types";
import StatusBadge from "./StatusBadge";

/**
 * Takvim hücresindeki kompakt kart (§9):
 * tür ikonu + saat + kısa başlık + durum.
 * Ay görünümünde sürüklenebilir (§21).
 */
export default function CalendarItemCard({
  item,
  thumbnailUrl,
  onOpen,
}: {
  item: CalendarItem;
  thumbnailUrl?: string;
  onOpen: (item: CalendarItem) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `calendar-item-${item.id}`,
    data: { itemId: item.id, scheduledAt: item.scheduledAt },
  });
  const type = ITEM_TYPE_META[item.itemType];
  const status = deriveStatus(item);
  const cancelled = item.status === "cancelled";

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      role="button"
      tabIndex={0}
      aria-label={`${formatTime(item.scheduledAt)} ${type.label}: ${item.title} — detay için aç, süratlemek için sürükleyin`}
      onClick={(event) => {
        event.stopPropagation();
        onOpen(item);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          event.stopPropagation();
          onOpen(item);
        }
      }}
      className={`calendar-card group mb-1 flex w-full cursor-grab items-start gap-1.5 rounded-md border border-slate-200 bg-white px-1.5 py-1 text-left shadow-sm transition hover:border-sky-300 hover:shadow focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-600 active:cursor-grabbing ${
        isDragging ? "animate-drop-pulse opacity-60" : ""
      } ${cancelled ? "opacity-60" : ""}`}
    >
      {thumbnailUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={thumbnailUrl}
          alt=""
          className="mt-0.5 size-6 shrink-0 rounded object-cover"
          draggable={false}
        />
      ) : (
        <span
          className="mt-0.5 grid size-6 shrink-0 place-items-center rounded bg-slate-100 text-slate-500"
          aria-hidden="true"
        >
          {item.itemType === "note" ? (
            <PaperClipIcon className="size-3.5" />
          ) : (
            <CalendarDaysIcon className="size-3.5" />
          )}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1 text-[11px] font-medium text-neutral-600">
          <ClockIcon className="size-3 shrink-0 text-neutral-400" aria-hidden="true" />
          <span className="tabular-nums">{formatTime(item.scheduledAt)}</span>
          <span className="truncate text-neutral-400">· {type.shortLabel}</span>
        </span>
        <span className="block truncate text-xs font-medium text-neutral-800">
          {item.title}
        </span>
        <span className="mt-0.5 hidden sm:block">
          <StatusBadge status={status} />
        </span>
      </span>
    </div>
  );
}
