"use client";

import { useEffect, useRef, useState } from "react";
import { BookmarkIcon, ClockIcon } from "@heroicons/react/16/solid";

import type { Brand, GridResult } from "@/lib/types";

function GridCellView({
  cell,
  onError,
  onSelect,
  selected,
}: {
  cell: GridResult["cells"][number];
  onError?: (id: string) => void;
  onSelect?: (id: string) => void;
  selected?: boolean;
}) {
  const { post, pinned } = cell;
  const [status, setStatus] = useState<"loading" | "loaded" | "error">(
    "loading",
  );
  const imgRef = useRef<HTMLImageElement>(null);

  // Önbellekten gelen görseller React onLoad bağlanmadan yüklenmiş olabilir;
  // mount sonrası complete durumunu kontrol et.
  useEffect(() => {
    const img = imgRef.current;
    if (!img || !img.complete) return;
    setStatus(img.naturalWidth > 0 ? "loaded" : "error");
  }, []);

  return (
    <button
      type="button"
      onClick={() => onSelect?.(post.id)}
      aria-label={`${post.alt}${selected ? ", seçili" : ""}`}
      className={`group relative aspect-square overflow-hidden bg-neutral-100 text-left outline-none transition duration-200 focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-sky-600 ${
        selected ? "ring-2 ring-inset ring-sky-600" : "hover:z-10 hover:ring-2 hover:ring-inset hover:ring-black/20"
      }`}
    >
      {status === "loading" ? (
        <div className="absolute inset-0 flex items-center justify-center bg-neutral-100">
        <span className="text-xs text-neutral-400">Yükleniyor…</span>
        </div>
      ) : null}
      {status === "error" ? (
        <div className="absolute inset-0 flex items-center justify-center bg-neutral-100 p-2 text-center">
          <span className="text-xs text-red-600">
            Görsel yüklenemedi
          </span>
        </div>
      ) : null}
      {/* Instagram 1:1 kırpma: object-cover ile merkezden kırpılır; orijinal dosya değişmez */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={imgRef}
        src={post.imageUrl}
        alt={post.alt ?? "Gönderi görseli"}
        className={`h-full w-full object-cover transition-opacity duration-200 ${
          status === "loaded" ? "opacity-100" : "opacity-0"
        }`}
        loading="lazy"
        onLoad={() => setStatus("loaded")}
        onError={() => {
          setStatus("error");
          onError?.(post.id);
        }}
      />
      {pinned ? (
        <span
          className="absolute left-2 top-2 inline-flex size-6 items-center justify-center rounded-full bg-black/70 text-white"
          title="Sabitlenmiş gönderi"
        >
          <BookmarkIcon className="size-3.5" aria-hidden="true" />
        </span>
      ) : null}
      {post.source === "planlanan" ? (
        <span className="absolute bottom-2 right-2 inline-flex items-center gap-1 rounded-full bg-sky-700 px-2 py-1 text-[11px] font-medium text-white shadow-sm">
          <ClockIcon className="size-3" aria-hidden="true" />
          Plan
        </span>
      ) : null}
    </button>
  );
}

export default function GridPreview({
  brand,
  result,
  onImageError,
  onSelectPost,
  selectedPostId,
}: {
  brand: Brand;
  result: GridResult;
  onImageError?: (id: string) => void;
  onSelectPost?: (id: string) => void;
  selectedPostId?: string | null;
}) {
  return (
    <section aria-label={`${brand.name} profil grid önizlemesi`}>
      <header className="mb-6 flex items-center gap-4 px-1">
        {brand.profileImageUrl ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={brand.profileImageUrl}
            alt={`${brand.name} profil görseli`}
            className="h-16 w-16 rounded-full object-cover outline-1 -outline-offset-1 outline-black/10"
          />
        ) : (
          <div
            aria-hidden="true"
            className="flex h-16 w-16 items-center justify-center rounded-full bg-neutral-200 text-xl font-medium"
          >
            {brand.name.charAt(0)}
          </div>
        )}
        <div className="min-w-0">
          <h2 className="truncate text-xl font-semibold tracking-tight">{brand.name}</h2>
          <p className="text-sm text-neutral-500">@{brand.username}</p>
          {brand.bio ? (
            <p className="mt-1 line-clamp-2 text-sm text-neutral-600">
              {brand.bio}
            </p>
          ) : null}
        </div>
      </header>

      <div className="grid grid-cols-3 gap-px overflow-hidden rounded-xl bg-black/10 outline-1 -outline-offset-1 outline-black/10">
        {result.cells.map((cell) => (
          <GridCellView
            key={cell.post.id}
            cell={cell}
            onError={onImageError}
            onSelect={onSelectPost}
            selected={selectedPostId === cell.post.id}
          />
        ))}
      </div>

      <p className="mt-4 text-sm text-neutral-500">
        {result.cells.length} gönderi · {result.rowCount} satır ·{" "}
        {result.pinnedCount} pinned
      </p>
    </section>
  );
}
