"use client";

import type { ExistingPost, PlannedPost, PostType } from "@/lib/types";

type Source = "mevcut" | "planlanan";

/**
 * Sağ panel: seçili gönderinin önizlemesi, türü, kaynağı, grid sırası ve
 * pin/sil aksiyonları. Seçim yoksa yardımcı empty state gösterir.
 */
export default function PostInspector({
  post,
  source,
  gridPosition,
  onTogglePin,
  onMovePinned,
  onPostTypeChange,
  onDelete,
  onClear,
}: {
  post: ExistingPost | PlannedPost | null;
  source: Source | null;
  /** Grid hücresindeki konum (1 tabanlı) ve toplam hücre sayısı. */
  gridPosition: { index: number; total: number } | null;
  onTogglePin?: () => void;
  onMovePinned?: (direction: -1 | 1) => void;
  onPostTypeChange?: (postType: PostType) => void;
  onDelete?: () => void;
  onClear?: () => void;
}) {
  if (!post || !source) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center">
        <p className="text-sm font-medium text-neutral-700">Seçili içerik yok</p>
        <p className="mt-1 text-sm text-neutral-500">
          Gridden bir görsel seçin; ayrıntılar ve hızlı aksiyonlar burada görünür.
        </p>
      </div>
    );
  }

  const pinned = source === "mevcut" && (post as ExistingPost).pinned;
  const title = post.alt ?? "Görsel";

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-neutral-900">Seçili içerik</h2>
        {onClear ? (
          <button
            type="button"
            onClick={onClear}
            className="rounded-md px-2 py-1 text-xs font-medium text-neutral-500 hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
          >
            Kapat
          </button>
        ) : null}
      </div>

      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={post.imageUrl}
        alt={title}
        className="aspect-square w-full rounded-lg object-cover outline-1 -outline-offset-1 outline-black/10"
      />

      <p className="mt-3 truncate text-sm font-medium text-neutral-900">{title}</p>

      <dl className="mt-2 space-y-1 text-sm text-neutral-600">
        <div className="flex justify-between gap-2">
          <dt className="text-neutral-500">Kaynak</dt>
          <dd className="font-medium text-neutral-800">
            {source === "mevcut" ? "Mevcut gönderi" : "Planlanan gönderi"}
          </dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-neutral-500">Grid sırası</dt>
          <dd className="font-medium text-neutral-800">
            {gridPosition ? `${gridPosition.index} / ${gridPosition.total}` : "Gridde değil"}
          </dd>
        </div>
        {pinned ? (
          <div className="flex justify-between gap-2">
            <dt className="text-neutral-500">Durum</dt>
            <dd className="font-medium text-amber-700">Sabitlenmiş</dd>
          </div>
        ) : null}
      </dl>

      <label className="mt-3 block text-sm text-neutral-600">
        İçerik türü
        <select
          aria-label={`${title} içerik türü`}
          value={post.postType ?? "post"}
          onChange={(event) => onPostTypeChange?.(event.target.value as PostType)}
          className="mt-1.5 block h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm outline-none focus:border-sky-600"
        >
          <option value="post">Post</option>
          <option value="reel">Reel</option>
          <option value="carousel">Carousel</option>
        </select>
      </label>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {source === "mevcut" && onTogglePin ? (
          <>
            <button
              type="button"
              onClick={onTogglePin}
              className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-neutral-800 hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
            >
              {pinned ? "Pin kaldır" : "Pinle"}
            </button>
            {pinned && onMovePinned ? (
              <>
                <button
                  type="button"
                  onClick={() => onMovePinned(-1)}
                  aria-label={`Pinned sırasında sola taşı: ${title}`}
                  className="grid size-9 place-items-center rounded-lg border border-slate-200 bg-white text-sm hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
                >
                  ←
                </button>
                <button
                  type="button"
                  onClick={() => onMovePinned(1)}
                  aria-label={`Pinned sırasında sağa taşı: ${title}`}
                  className="grid size-9 place-items-center rounded-lg border border-slate-200 bg-white text-sm hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
                >
                  →
                </button>
              </>
            ) : null}
          </>
        ) : null}
        {onDelete ? (
          <button
            type="button"
            onClick={onDelete}
            aria-label={`Sil: ${title}`}
            className="h-9 rounded-lg px-3 text-sm font-medium text-red-700 hover:bg-red-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600"
          >
            Sil
          </button>
        ) : null}
      </div>
    </div>
  );
}
