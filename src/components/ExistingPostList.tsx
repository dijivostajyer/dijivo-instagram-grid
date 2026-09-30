"use client";

import { useRef, useState } from "react";

import { loadImageFile } from "@/lib/validators";
import type { ExistingPost } from "@/lib/types";

/**
 * Mevcut gönderi yönetimi: görsel yükleme, yayın sırası kontrolü
 * ("en yeni" / "en eski"), pin/unpin, pinned soldan-sağa taşıma ve silme.
 */
export default function ExistingPostList({
  posts,
  pinnedCount,
  pinError,
  onUpload,
  onDelete,
  onTogglePin,
  onMovePinned,
}: {
  posts: ExistingPost[];
  pinnedCount: number;
  pinError: string | null;
  onUpload: (input: {
    url: string;
    alt: string;
    recency: "enYeni" | "enEski";
  }) => void;
  onDelete: (id: string) => void;
  onTogglePin: (id: string, pinned: boolean) => void;
  onMovePinned: (id: string, direction: -1 | 1) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [recency, setRecency] = useState<"enYeni" | "enEski">("enYeni");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      const { url, alt } = await loadImageFile(file);
      onUpload({ url, alt, recency });
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
        <div className="flex gap-2">
        <select
          id="recency-select"
          value={recency}
          onChange={(e) =>
            setRecency(e.target.value as "enYeni" | "enEski")
          }
          className="min-w-0 flex-1 rounded-lg border border-black/10 bg-white px-2.5 py-2 text-sm outline-none focus:border-sky-700"
        >
          <option value="enYeni">En yeni (gridin en üstü)</option>
          <option value="enEski">En eski (listeye ekle)</option>
        </select>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={busy}
          className="h-9 shrink-0 rounded-lg bg-neutral-900 px-3 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50"
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

      {posts.length === 0 ? (
        <p className="rounded-xl border border-dashed border-black/15 p-5 text-center text-sm text-neutral-500">
          Henüz mevcut gönderi yok. Yukarıdan görsel yükleyin.
        </p>
      ) : (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-2">
          {posts.map((post) => (
            <li
              key={post.id}
              className={`group relative overflow-hidden rounded-xl bg-white outline-1 -outline-offset-1 outline-black/10 ${
                post.pinned
                  ? "ring-2 ring-inset ring-amber-400"
                  : ""
              }`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={post.imageUrl}
                alt=""
                className="aspect-square w-full object-cover"
              />
              <span className="block truncate px-2 pt-2 text-sm font-medium text-neutral-700">
                {post.alt ?? post.id}
              </span>

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
