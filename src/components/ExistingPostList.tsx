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
    <section className="rounded-lg border border-neutral-200 p-4">
      <h2 className="mb-3 text-sm font-semibold">Mevcut Gönderiler</h2>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <label className="text-xs text-neutral-600" htmlFor="recency-select">
          Yeni gönderi şu konuma eklensin:
        </label>
        <select
          id="recency-select"
          value={recency}
          onChange={(e) =>
            setRecency(e.target.value as "enYeni" | "enEski")
          }
          className="rounded border border-neutral-300 px-2 py-1 text-xs"
        >
          <option value="enYeni">En yeni (gridin en üstü)</option>
          <option value="enEski">En eski (listeye ekle)</option>
        </select>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={busy}
          className="rounded bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-700 disabled:opacity-50"
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
      {error ? (
        <p role="alert" className="mb-2 text-xs font-medium text-red-600">
          {error}
        </p>
      ) : null}
      {pinError ? (
        <p role="alert" className="mb-2 text-xs font-medium text-red-600">
          {pinError}
        </p>
      ) : null}

      {posts.length === 0 ? (
        <p className="rounded border border-dashed border-neutral-300 p-4 text-center text-xs text-neutral-500">
          Henüz mevcut gönderi yok. Yukarıdan görsel yükleyin.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {posts.map((post) => (
            <li
              key={post.id}
              className={`flex flex-wrap items-center gap-2 rounded border p-2 ${
                post.pinned
                  ? "border-amber-300 bg-amber-50"
                  : "border-neutral-200 bg-white"
              }`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={post.imageUrl}
                alt=""
                className="h-12 w-12 shrink-0 rounded object-cover"
              />
              <span className="min-w-0 flex-1 truncate text-xs text-neutral-700">
                {post.alt ?? post.id}
              </span>

              {post.pinned ? (
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => onMovePinned(post.id, -1)}
                    className="rounded px-1.5 py-1 text-xs hover:bg-neutral-100"
                    aria-label={`Pinned sırasında sola taşı: ${post.alt ?? post.id}`}
                  >
                    ←
                  </button>
                  <button
                    type="button"
                    onClick={() => onMovePinned(post.id, 1)}
                    className="rounded px-1.5 py-1 text-xs hover:bg-neutral-100"
                    aria-label={`Pinned sırasında sağa taşı: ${post.alt ?? post.id}`}
                  >
                    →
                  </button>
                </div>
              ) : null}

              <button
                type="button"
                onClick={() => onTogglePin(post.id, post.pinned)}
                className="rounded px-2 py-1 text-xs hover:bg-neutral-100"
              >
                {post.pinned ? "Pin kaldır" : "Pinle"}
              </button>
              <button
                type="button"
                onClick={() => onDelete(post.id)}
                className="rounded px-2 py-1 text-xs text-red-600 hover:bg-red-50"
                aria-label={`Sil: ${post.alt ?? post.id}`}
              >
                Sil
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-[11px] text-neutral-400">
        {pinnedCount}/3 pinned
      </p>
    </section>
  );
}
