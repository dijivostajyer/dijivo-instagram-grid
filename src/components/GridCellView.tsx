"use client";

import { useEffect, useRef, useState, type CSSProperties, type HTMLAttributes } from "react";
import {
  BookmarkIcon,
  ClockIcon,
  PlayIcon,
  RectangleStackIcon,
} from "@heroicons/react/16/solid";

import { gridCellAspectClass, gridCellMediaSrc } from "@/lib/grid-ratio";
import type { GridResult } from "@/lib/types";

/**
 * Tek grid hücresi: editör, sürüklenebilir editör gridi ve salt-okunur
 * Share aynı görünümü kullanır. dnd-kit'e bağımlı DEĞİLDİR; sürükleme
 * özellikleri yalnız `drag` ile dışarıdan verilir (SortableGrid).
 */
export interface GridCellViewProps {
  cell: GridResult["cells"][number];
  dark: boolean;
  onError?: (id: string) => void;
  onSelect?: (id: string) => void;
  selected?: boolean;
}

/** Hücre listesini çizen bileşene (salt-okunur veya SortableGrid) verilen argümanlar. */
export interface GridRenderArgs {
  cells: GridResult["cells"];
  className: string;
  cellProps: (cell: GridResult["cells"][number]) => Omit<GridCellViewProps, "cell">;
}

/** Sürüklenebilir hücreye bağlanan dnd-kit özellikleri (salt-okunur gridde yok). */
export interface GridCellDragProps {
  ref: (node: HTMLElement | null) => void;
  style: CSSProperties;
  attributes: HTMLAttributes<HTMLElement>;
  listeners: HTMLAttributes<HTMLElement> | undefined;
  isDragging: boolean;
  /** Sürükleme sürerken bu hücreye bırakılamaz (farklı bölge). */
  blocked: boolean;
}

export default function GridCellView({
  cell,
  dark,
  onError,
  onSelect,
  selected,
  drag,
}: {
  cell: GridResult["cells"][number];
  dark: boolean;
  onError?: (id: string) => void;
  onSelect?: (id: string) => void;
  selected?: boolean;
  drag?: GridCellDragProps;
}) {
  const { post, pinned } = cell;
  // Reel: kapak görseli varsa onu göster; yoksa ana görsel
  // (güvenli fallback — eski reel kayıtları bozulmaz, §4). Export da aynı
  // helper'ı kullanır.
  const mediaSrc = gridCellMediaSrc(post);
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

  const placeholderBg = dark ? "bg-neutral-900" : "bg-neutral-100";
  const ringTheme = dark ? "hover:ring-white/25" : "hover:ring-black/20";

  // Sürükleme geri bildirimi: taşınan kart yükselir; farklı bölgedeki
  // (bırakılamaz) kartlar soluklaşır.
  const dragClass = drag?.isDragging
    ? "z-20 scale-[1.04] cursor-grabbing opacity-90 shadow-2xl ring-2 ring-inset ring-sky-600"
    : drag?.blocked
      ? "cursor-not-allowed opacity-40 grayscale"
      : drag
        ? "cursor-grab"
        : "";

  return (
    <button
      type="button"
      {...drag?.attributes}
      {...drag?.listeners}
      ref={drag?.ref}
      style={drag?.style}
      // Sürüklenebilir kartta Space klavyeyle taşır; tarayıcının Space
      // keyup'ında ürettiği tıklama modalı açmasın (Enter açmaya devam eder).
      onKeyUp={drag ? (event) => { if (event.code === "Space") event.preventDefault(); } : undefined}
      onClick={() => onSelect?.(post.id)}
      aria-label={`${post.alt}${selected ? ", seçili" : ""}`}
      className={`group relative ${gridCellAspectClass(post.postType)} touch-manipulation overflow-hidden text-left outline-none transition duration-200 focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-sky-600 ${
        selected
          ? "ring-2 ring-inset ring-sky-600"
          : `hover:z-10 hover:ring-2 hover:ring-inset ${ringTheme}`
      } ${dragClass}`}
    >
      {status === "loading" ? (
        <div
          className={`absolute inset-0 flex items-center justify-center ${placeholderBg}`}
        >
          <span className={`text-xs ${dark ? "text-neutral-500" : "text-neutral-400"}`}>
            Yükleniyor…
          </span>
        </div>
      ) : null}
      {status === "error" ? (
        <div
          className={`absolute inset-0 flex items-center justify-center ${placeholderBg} p-2 text-center`}
        >
          <span className="text-xs text-red-500">Görsel yüklenemedi</span>
        </div>
      ) : null}
      {/* Hücre oranında (Post 3:4, Reel 2:3) object-cover ile merkezden kırpılır; orijinal dosya değişmez */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={imgRef}
        src={mediaSrc}
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
      {post.postType === "reel" ? (
        <span className="absolute right-2 top-2 rounded-full bg-black/70 p-1 text-white" title="Reel">
          <PlayIcon className="size-3" aria-hidden="true" />
        </span>
      ) : null}
      {post.postType === "carousel" ? (
        <span className="absolute right-2 top-2 rounded-full bg-black/70 p-1 text-white" title="Carousel">
          <RectangleStackIcon className="size-3" aria-hidden="true" />
        </span>
      ) : null}
    </button>
  );
}
