"use client";

import { useState, type ReactNode } from "react";
import {
  GlobeAltIcon,
  MoonIcon,
  SunIcon,
  VideoCameraIcon,
  Squares2X2Icon,
} from "@heroicons/react/16/solid";
import GridCellView, { type GridRenderArgs } from "./GridCellView";
import StoryViewer from "./StoryViewer";

import type { Brand, GridResult, Story } from "@/lib/types";
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

export default function GridPreview({
  brand,
  result,
  onImageError,
  onSelectPost,
  selectedPostId,
  stories,
  renderGrid,
}: {
  brand: Brand;
  result: GridResult;
  onImageError?: (id: string) => void;
  onSelectPost?: (id: string) => void;
  selectedPostId?: string | null;
  stories?: Story[];
  /**
   * Verilirse tam grid (POST sekmesi) bununla çizilir; editör sürüklenebilir
   * SortableGrid'i verir. Share vermez ve dnd-kit hiç yüklenmez.
   */
  renderGrid?: (args: GridRenderArgs) => ReactNode;
}) {
  const [theme, toggleTheme] = useInstagramPreviewTheme();
  const dark = theme === "dark";
  const [tab, setTab] = useState<PreviewTab>("post");
  const [storyOpen, setStoryOpen] = useState(false);
  const activeStories = (stories ?? []).filter((story) => !story.expiresAt || Date.parse(story.expiresAt) > Date.now());

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
        {activeStories.length ? (
          <button type="button" onClick={() => setStoryOpen(true)} aria-label={`${brand.name} Story'lerini aç`} className={`shrink-0 rounded-full bg-gradient-to-tr from-yellow-400 via-pink-500 to-violet-500 p-[3px] ${highlightRing(theme)} ring-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600`}>
            {brand.profileImageUrl ? <img src={brand.profileImageUrl} alt={`${brand.name} profil görseli`} className="h-16 w-16 rounded-full object-cover sm:h-24 sm:w-24" /> : <span className={`flex h-16 w-16 items-center justify-center rounded-full text-xl font-medium sm:h-24 sm:w-24 ${dark ? "bg-neutral-800" : "bg-neutral-200"}`}>{brand.name.charAt(0)}</span>}
          </button>
        ) : brand.profileImageUrl ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={brand.profileImageUrl} alt={`${brand.name} profil görseli`} className="h-16 w-16 shrink-0 rounded-full object-cover outline-1 -outline-offset-1 outline-black/10 sm:h-24 sm:w-24" />
        ) : <div aria-hidden="true" className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-full text-xl font-medium sm:h-24 sm:w-24 ${dark ? "bg-neutral-800" : "bg-neutral-200"}`}>{brand.name.charAt(0)}</div>}
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
          {brand.username ? (
            <a
              href={`https://www.instagram.com/${encodeURIComponent(brand.username)}/`}
              target="_blank"
              rel="noreferrer"
              className={`mt-1 block text-sm font-medium text-sky-700 hover:underline dark:text-sky-400`}
            >
              Instagram profilini aç
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
      {storyOpen ? <StoryViewer brand={brand} stories={activeStories} onClose={() => setStoryOpen(false)} /> : null}

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
      {visibleCells.length && renderGrid && tab === "post" ? (
        renderGrid({
          cells: visibleCells,
          className: `mt-3 grid grid-cols-3 gap-px px-1 ${separator}`,
          cellProps: (cell) => ({
            dark,
            onError: onImageError,
            onSelect: onSelectPost,
            selected: selectedPostId === cell.post.id,
          }),
        })
      ) : visibleCells.length ? (
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
        <div className={`px-4 py-10 text-center ${textMuted}`}>
          <p className="text-sm font-semibold">{tab === "reels" ? "Bu profilde reel yok." : "Henüz gönderi eklenmedi."}</p>
          {tab === "post" ? <p className="mx-auto mt-1 max-w-sm text-sm">Instagram’dan gönderi içe aktarabilir veya manuel olarak yeni gönderi ekleyebilirsiniz.</p> : null}
        </div>
      )}

      <p className={`mt-4 px-4 pb-4 text-sm ${textMuted}`}>
        {result.cells.length} gönderi · {result.rowCount} satır ·{" "}
        {result.pinnedCount} sabitlenmiş
      </p>
    </section>
  );
}
