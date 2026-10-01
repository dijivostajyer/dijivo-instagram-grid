"use client";

import type { GridResult } from "@/lib/types";

/**
 * Salt-okunur mini grid önizlemesi: gerçek grid hücrelerinden ilk N'sini
 * gösterir. Grid algoritmasına dokunmaz; yalnızca sunumdur.
 */
export default function MiniGridPreview({
  cells,
  max = 9,
}: {
  cells: GridResult["cells"];
  max?: number;
}) {
  const shown = cells.slice(0, max);
  const remaining = cells.length - shown.length;
  const padCount = shown.length === 0 ? 0 : (3 - (shown.length % 3)) % 3;

  if (shown.length === 0) {
    return (
      <div
        aria-label="Grid henüz boş"
        className="grid aspect-square w-full grid-cols-3 gap-1 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-2"
      >
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <span key={i} className="rounded bg-slate-100" aria-hidden="true" />
        ))}
      </div>
    );
  }

  return (
    <div>
      <div className="grid grid-cols-3 gap-1">
        {shown.map((cell) => (
          <div
            key={cell.post.id}
            className="aspect-square overflow-hidden rounded-md bg-neutral-100 ring-1 ring-black/5"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={cell.post.imageUrl}
              alt=""
              loading="lazy"
              className="h-full w-full object-cover"
            />
          </div>
        ))}
        {Array.from({ length: padCount }, (_, i) => (
          <span
            key={`pad-${i}`}
            className="aspect-square rounded-md bg-slate-100 ring-1 ring-black/5"
            aria-hidden="true"
          />
        ))}
      </div>
      {remaining > 0 ? (
        <p className="mt-1.5 text-xs text-neutral-500">
          +{remaining} içerik daha
        </p>
      ) : null}
    </div>
  );
}
