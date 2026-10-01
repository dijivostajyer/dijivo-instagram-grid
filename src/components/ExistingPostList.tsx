"use client";

import { useRef, useState } from "react";

import { filterByType, type TypeFilter } from "@/lib/plan-stats";
import { loadImageFile } from "@/lib/validators";
import type { ExistingPost, PostType } from "@/lib/types";

/**
 * Mevcut gönderi yönetimi: görsel yükleme, yayın sırası kontrolü
 * ("en yeni" / "en eski"), pin/unpin, pinned soldan-sağa taşıma ve silme.
 */
export default function ExistingPostList({
  posts,
  typeFilter = "all",
  pinnedCount,
  pinError,
  onUpload,
  onDelete,
  onTogglePin,
  onMovePinned,
  onPostTypeChange,
  onSelect,
  selectionMode = false,
  selectedIds,
  onToggleSelect,
}: {
  posts: ExistingPost[];
  /** Tür filtresi (Tümü/Post/Reel/Carousel); yalnızca görüntüyü etkiler. */
  typeFilter?: TypeFilter;
  pinnedCount: number;
  pinError: string | null;
  onUpload: (input: {
    url: string;
    alt: string;
    recency: "enYeni" | "enEski";
    postType: PostType;
    aspectRatio: "1:1" | "3:4" | "4:3" | "16:9";
  }) => void;
  onDelete: (id: string) => void;
  onTogglePin: (id: string, pinned: boolean) => void;
  onMovePinned: (id: string, direction: -1 | 1) => void;
  onPostTypeChange: (id: string, postType: PostType) => void;
  /** Gönderi kartına tıklandığında çağrılır (düzenleme modalı açılır). */
  onSelect: (id: string) => void;
  /** §18: çoklu seçim modu; etkinleşince kart tıklaması seçimi değiştirir. */
  selectionMode?: boolean;
  selectedIds?: ReadonlySet<string>;
  onToggleSelect?: (id: string) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [recency, setRecency] = useState<"enYeni" | "enEski">("enYeni");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [postType, setPostType] = useState<PostType>("post");
  const visiblePosts = filterByType(posts, typeFilter);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      const { url, alt, aspectRatio } = await loadImageFile(file);
      onUpload({ url, alt, recency, postType, aspectRatio });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Görsel yüklenemedi.");
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  return (
    <section>
      <div className="mb-4 grid gap-2">
        <label className="text-sm text-neutral-600" htmlFor="recency-select">Yeni görsel konumu</label>
        <div className="grid gap-2">
        <select
          id="recency-select"
          value={recency}
          onChange={(e) =>
            setRecency(e.target.value as "enYeni" | "enEski")
          }
          className="h-9 w-full rounded-lg border border-black/10 bg-white px-2.5 text-sm outline-none focus:border-sky-700"
        >
          <option value="enYeni">En yeni (gridin en üstü)</option>
          <option value="enEski">En eski (listeye ekle)</option>
        </select>
        <div className="flex items-center gap-2">
        <select aria-label="İçerik türü" value={postType} onChange={(e) => setPostType(e.target.value as PostType)} className="h-9 min-w-0 flex-1 rounded-lg border border-black/10 bg-white px-2 text-sm focus:border-sky-700">
          <option value="post">Post</option>
          <option value="reel">Reel</option>
          <option value="carousel">Carousel</option>
        </select>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={busy}
          className="inline-flex h-9 shrink-0 items-center rounded-lg bg-neutral-900 px-3 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50"
        >
          {busy ? "Yükleniyor…" : "Görsel yükle"}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => handleFile(e.target.files?.[0])}
        />
        </div>
        </div>
      </div>
      {error ? (
        <p role="alert" className="mb-3 text-sm font-medium text-red-700">
          {error}
        </p>
      ) : null}
      {pinError ? (
        <p role="alert" className="mb-3 text-sm font-medium text-red-700">
          {pinError}
        </p>
      ) : null}

      {visiblePosts.length === 0 ? (
        <p className="rounded-xl border border-dashed border-black/15 p-5 text-center text-sm text-neutral-500">
          {posts.length === 0
            ? "Henüz mevcut gönderi yok. Yukarıdan görsel yükleyin."
            : "Bu filtrede gönderi yok."}
        </p>
      ) : (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-2">
          {visiblePosts.map((post) => (
            <li
              key={post.id}
              className={`group relative overflow-hidden rounded-xl bg-white outline-1 -outline-offset-1 outline-black/10 ${
                post.pinned
                  ? "ring-2 ring-inset ring-amber-400"
                  : ""
              }`}
            >
              <button
                type="button"
                onClick={() =>
                  selectionMode
                    ? onToggleSelect?.(post.id)
                    : onSelect(post.id)
                }
                aria-label={
                  selectionMode
                    ? `Seç: ${post.alt ?? post.id}`
                    : `Düzenle: ${post.alt ?? post.id}`
                }
                aria-pressed={selectionMode ? selectedIds?.has(post.id) : undefined}
                className={`block w-full text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600 ${
                  selectionMode && selectedIds?.has(post.id)
                    ? "ring-2 ring-inset ring-sky-600"
                    : ""
                }`}
              >
                <span className="relative block">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={post.imageUrl}
                    alt=""
                    className="aspect-square w-full object-cover"
                  />
                  {selectionMode ? (
                    <span
                      className={`absolute left-1.5 top-1.5 inline-flex size-5 items-center justify-center rounded-full border ${
                        selectedIds?.has(post.id)
                          ? "border-sky-700 bg-sky-700 text-white"
                          : "border-white/90 bg-white/80 text-transparent"
                      }`}
                      aria-hidden="true"
                    >
                      <svg viewBox="0 0 12 12" className="size-3" fill="none">
                        <path
                          d="M2 6.5 4.5 9 10 3.5"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </span>
                  ) : null}
                </span>
                <span className="block truncate px-2 pt-2 text-sm font-medium text-neutral-700 hover:text-sky-700">
                  {post.alt ?? post.id}
                </span>
              </button>
              <select aria-label={`${post.alt ?? post.id} içerik türü`} value={post.postType ?? "post"} onChange={(event) => onPostTypeChange(post.id, event.target.value as PostType)} className="mx-2 mt-1 w-[calc(100%-1rem)] rounded border border-black/10 bg-white px-1 py-1 text-xs">
                <option value="post">Post</option><option value="reel">Reel</option><option value="carousel">Carousel</option>
              </select>

              {post.pinned ? (
                <div className="flex items-center gap-1 px-1 pt-1">
                  <button
                    type="button"
                    onClick={() => onMovePinned(post.id, -1)}
                    className="rounded-md px-1.5 py-1 text-sm hover:bg-neutral-100"
                    aria-label={`Pinned sırasında sola taşı: ${post.alt ?? post.id}`}
                  >
                    ←
                  </button>
                  <button
                    type="button"
                    onClick={() => onMovePinned(post.id, 1)}
                    className="rounded-md px-1.5 py-1 text-sm hover:bg-neutral-100"
                    aria-label={`Pinned sırasında sağa taşı: ${post.alt ?? post.id}`}
                  >
                    →
                  </button>
                </div>
              ) : null}

              <div className="flex items-center justify-between p-2 pt-1">
              <button
                type="button"
                onClick={() => onTogglePin(post.id, post.pinned)}
                className="rounded-md px-2 py-1 text-sm font-medium hover:bg-neutral-100"
              >
                {post.pinned ? "Pin kaldır" : "Pinle"}
              </button>
              <button
                type="button"
                onClick={() => onDelete(post.id)}
                className="rounded-md px-2 py-1 text-sm font-medium text-red-700 hover:bg-red-50"
                aria-label={`Sil: ${post.alt ?? post.id}`}
              >
                Sil
              </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-sm text-neutral-500">
        {pinnedCount}/3 pinned
      </p>
    </section>
  );
}
