"use client";

import { useEffect, useRef, useState } from "react";
import {
  BookmarkIcon,
  ClockIcon,
  GlobeAltIcon,
  MoonIcon,
  PlayIcon,
  RectangleStackIcon,
  SunIcon,
  VideoCameraIcon,
  Squares2X2Icon,
} from "@heroicons/react/16/solid";

import type { Brand, GridResult } from "@/lib/types";
import {
  useInstagramPreviewTheme,
  type IgPreviewTheme,
} from "@/lib/ig-preview-theme";

type PreviewTab = "post" | "reels";

const tabLabels: Record<PreviewTab, string> = {
  post: "POST",
  reels: "REELS",
};

function formatCount(value: number): string {
  return value.toLocaleString("tr-TR");
}

function GridCellView({
  cell,
  dark,
  onError,
  onSelect,
  selected,
}: {
  cell: GridResult["cells"][number];
  dark: boolean;
  onError?: (id: string) => void;
  onSelect?: (id: string) => void;
  selected?: boolean;
}) {
  const { post, pinned } = cell;
  // Reel: kapak görseli varsa onu göster; yoksa ana görsel
  // (güvenli fallback — eski reel kayıtları bozulmaz, §4).
  const mediaSrc =
    post.mediaType === "video" && post.coverImageUrl
      ? post.coverImageUrl
      : post.imageUrl;
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

  return (
    <button
      type="button"
      onClick={() => onSelect?.(post.id)}
      aria-label={`${post.alt}${selected ? ", seçili" : ""}`}
      className={`group relative aspect-square overflow-hidden text-left outline-none transition duration-200 focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-sky-600 ${
        selected
          ? "ring-2 ring-inset ring-sky-600"
          : `hover:z-10 hover:ring-2 hover:ring-inset ${ringTheme}`
      }`}
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
      {/* Instagram 1:1 kırpma: object-cover ile merkezden kırpılır; orijinal dosya değişmez */}
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
  const [theme, toggleTheme] = useInstagramPreviewTheme();
  const dark = theme === "dark";
  const [tab, setTab] = useState<PreviewTab>("post");

  const postCount = brand.postCount ?? result.cells.length;
  const reelCells = result.cells.filter((cell) => cell.post.postType === "reel");
  const visibleCells = tab === "post" ? result.cells : reelCells;
  const separator = dark ? "bg-neutral-800" : "bg-black/10";
  const textPrimary = dark ? "text-neutral-100" : "text-neutral-900";
  const textMuted = dark ? "text-neutral-400" : "text-neutral-500";
  const textBody = dark ? "text-neutral-300" : "text-neutral-600";

  const websiteHref = brand.website
    ? /^https?:\/\//i.test(brand.website)
      ? brand.website
      : `https://${brand.website}`
    : null;

  const highlightRing = (tone: IgPreviewTheme) =>
    tone === "dark" ? "ring-neutral-900" : "ring-white";

  return (
    <section
      aria-label={`${brand.name} profil grid önizlemesi`}
      className={`overflow-hidden rounded-2xl ${
        dark ? "bg-black text-neutral-100" : "bg-white text-neutral-900"
      }`}
    >
      {/* Profil başlığı (§14: gerçek Instagram profili görünümü) */}
      <header className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:p-6">
        {brand.profileImageUrl ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={brand.profileImageUrl}
            alt={`${brand.name} profil görseli`}
            className="h-16 w-16 shrink-0 rounded-full object-cover outline-1 -outline-offset-1 outline-black/10 sm:h-24 sm:w-24"
          />
        ) : (
          <div
            aria-hidden="true"
            className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-full text-xl font-medium sm:h-24 sm:w-24 ${
              dark ? "bg-neutral-800" : "bg-neutral-200"
            }`}
          >
            {brand.name.charAt(0)}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <h2 className={`truncate text-xl font-semibold tracking-tight ${textPrimary}`}>
              {brand.username}
            </h2>
            <button
              type="button"
              onClick={toggleTheme}
              aria-label={dark ? "Açık temaya geç" : "Koyu temaya geç"}
              title={dark ? "Açık tema" : "Koyu tema"}
              className={`inline-flex size-8 shrink-0 items-center justify-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600 ${
                dark
                  ? "text-neutral-300 hover:bg-neutral-800"
                  : "text-neutral-500 hover:bg-neutral-100"
              }`}
            >
              {dark ? (
                <SunIcon className="size-4" aria-hidden="true" />
              ) : (
                <MoonIcon className="size-4" aria-hidden="true" />
              )}
            </button>
          </div>
          <p className={`mt-1 text-sm ${textBody}`}>
            <strong className={`font-semibold ${textPrimary}`}>
              {formatCount(postCount)}
            </strong>{" "}
            gönderi{" "}
            <strong className={`font-semibold ${textPrimary}`}>
              {formatCount(brand.followersCount ?? 0)}
            </strong>{" "}
            takipçi{" "}
            <strong className={`font-semibold ${textPrimary}`}>
              {formatCount(brand.followingCount ?? 0)}
            </strong>{" "}
            takip
          </p>
          {brand.displayName ? (
            <p className={`mt-1 font-semibold ${textPrimary}`}>
              {brand.displayName}
            </p>
          ) : null}
          {brand.bio ? (
            <p className={`mt-1 line-clamp-2 whitespace-pre-line text-sm ${textBody}`}>
              {brand.bio}
            </p>
          ) : null}
          {brand.website ? (
            <a
              href={websiteHref ?? undefined}
              target="_blank"
              rel="noreferrer"
              className={`mt-1 inline-flex items-center gap-1.5 text-sm font-medium text-sky-700 hover:underline dark:text-sky-400`}
            >
              <GlobeAltIcon className="size-3.5" aria-hidden="true" />
              {brand.website}
            </a>
          ) : null}
        </div>
      </header>

      {/* Öne çıkanlar (§14) */}
      {brand.highlights?.length ? (
        <div className="flex gap-4 overflow-x-auto px-4 pb-1 sm:px-6" role="list" aria-label="Öne çıkanlar">
          {brand.highlights.map((highlight) => (
            <div
              key={highlight.id}
              role="listitem"
              className="w-16 shrink-0 text-center"
            >
              <span
                className={`mx-auto block w-fit rounded-full bg-gradient-to-tr from-yellow-400 via-pink-500 to-violet-500 p-[2.5px] ${highlightRing(theme)} ring-2`}
              >
                {highlight.imageUrl ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={highlight.imageUrl}
                    alt=""
                    className="block size-12 rounded-full object-cover"
                  />
                ) : (
                  <span
                    className={`block size-12 rounded-full ${
                      dark ? "bg-neutral-800" : "bg-neutral-100"
                    }`}
                  />
                )}
              </span>
              <span className={`mt-1 block truncate text-xs ${textMuted}`}>
                {highlight.title}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      {/* Post / Reels sekmeleri (§14) */}
      <div
        className={`mt-4 flex justify-center gap-10 border-t ${separator}`}
        role="tablist"
        aria-label="Profil sekmesi"
      >
        {(Object.keys(tabLabels) as PreviewTab[]).map((key) => {
          const active = tab === key;
          const count = key === "post" ? result.cells.length : reelCells.length;
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTab(key)}
              className={`relative flex items-center gap-1.5 px-2 pt-3 text-xs font-semibold uppercase tracking-wide transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600 ${
                active
                  ? `${textPrimary}`
                  : `${textMuted} hover:${dark ? "hover:text-neutral-200" : "hover:text-neutral-700"}`
              }`}
            >
              <span
                className={`absolute inset-x-0 -top-px border-t-2 ${
                  active ? "border-current" : "border-transparent"
                }`}
                aria-hidden="true"
              />
              {key === "post" ? (
                <Squares2X2Icon className="size-3.5" aria-hidden="true" />
              ) : (
                <VideoCameraIcon className="size-3.5" aria-hidden="true" />
              )}
              {tabLabels[key]}
              <span className={`font-normal normal-case ${textMuted}`}>
                {formatCount(count)}
              </span>
            </button>
          );
        })}
      </div>

      {/* Izgara (§14: 3 sütun) */}
      {visibleCells.length ? (
        <div className={`mt-3 grid grid-cols-3 gap-px px-1 ${separator}`}>
          {visibleCells.map((cell) => (
            <GridCellView
              key={cell.post.id}
              cell={cell}
              dark={dark}
              onError={onImageError}
              onSelect={onSelectPost}
              selected={selectedPostId === cell.post.id}
            />
          ))}
        </div>
      ) : (
        <p className={`px-4 py-10 text-center text-sm ${textMuted}`}>
          {tab === "reels" ? "Bu profilde reel yok." : "Henüz gönderi yok."}
        </p>
      )}

      <p className={`mt-4 px-4 pb-4 text-sm ${textMuted}`}>
        {result.cells.length} gönderi · {result.rowCount} satır ·{" "}
        {result.pinnedCount} sabitlenmiş
      </p>
    </section>
  );
}
