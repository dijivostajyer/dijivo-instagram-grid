import { STATUS_META, type DisplayStatus } from "@/lib/calendar-types";

/**
 * Durum badge'i (§8): renk + nokta + metin —
 * renk tek başına anlam taşımaz (accessibility).
 */
export default function StatusBadge({ status }: { status: DisplayStatus }) {
  const meta = STATUS_META[status];
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ${meta.classes}`}
    >
      <span className={`size-1.5 shrink-0 rounded-full ${meta.dot}`} aria-hidden="true" />
      {meta.label}
    </span>
  );
}
