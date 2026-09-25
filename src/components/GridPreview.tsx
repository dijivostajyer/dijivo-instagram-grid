"use client";

import { useEffect, useRef, useState } from "react";

import type { Brand, GridResult } from "@/lib/types";

function GridCellView({
  cell,
  onError,
}: {
  cell: GridResult["cells"][number];
  onError?: (id: string) => void;
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
    <div className="relative aspect-square overflow-hidden bg-neutral-100">
      {status === "loading" ? (
        <div className="absolute inset-0 flex items-center justify-center bg-neutral-100">
          <span className="text-[10px] text-neutral-400">Yükleniyor…</span>
        </div>
      ) : null}
      {status === "error" ? (
        <div className="absolute inset-0 flex items-center justify-center bg-neutral-100 p-2 text-center">
          <span className="text-[10px] text-red-600">
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
          className="absolute left-1 top-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-white"
          title="Sabitlenmiş gönderi"
        >
          📌
        </span>
      ) : null}
      {post.source === "planlanan" ? (
        <span className="absolute right-1 top-1 rounded bg-sky-600/90 px-1.5 py-0.5 text-[10px] font-medium text-white">
          Planlanan
        </span>
      ) : null}
    </div>
  );
}

export default function GridPreview({
  brand,
  result,
  onImageError,
}: {
  brand: Brand;
  result: GridResult;
  onImageError?: (id: string) => void;
}) {
  return (
    <section aria-label={`${brand.name} profil grid önizlemesi`}>
      <header className="mb-4 flex items-center gap-3">
        {brand.profileImageUrl ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={brand.profileImageUrl}
            alt={`${brand.name} profil görseli`}
            className="h-16 w-16 rounded-full object-cover"
          />
        ) : (
          <div
            aria-hidden="true"
            className="flex h-16 w-16 items-center justify-center rounded-full bg-neutral-200 text-xl"
          >
            {brand.name.charAt(0)}
          </div>
        )}
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold">{brand.name}</h2>
          <p className="text-sm text-neutral-500">@{brand.username}</p>
          {brand.bio ? (
            <p className="mt-0.5 line-clamp-2 text-xs text-neutral-700">
              {brand.bio}
            </p>
          ) : null}
        </div>
      </header>

      <div className="grid grid-cols-3">
        {result.cells.map((cell) => (
          <GridCellView key={cell.post.id} cell={cell} onError={onImageError} />
        ))}
      </div>

      <p className="mt-3 text-xs text-neutral-500">
        {result.cells.length} gönderi · {result.rowCount} satır ·{" "}
        {result.pinnedCount} pinned
      </p>
    </section>
  );
}
