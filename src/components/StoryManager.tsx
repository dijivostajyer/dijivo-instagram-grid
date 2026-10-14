"use client";

import { useRef, useState } from "react";
import { PlayIcon, PlusIcon } from "@heroicons/react/16/solid";

import { sortStories } from "@/lib/story-ops";
import { loadImageFile, loadVideoFile } from "@/lib/validators";
import type { Story } from "@/lib/types";

/**
 * Aktif aylık planın Story'leri. Story'ler ay (proje) bazlıdır: yalnız
 * seçili ayın Story'leri listelenir, eklenen Story o aya yazılır.
 */
export default function StoryManager({
  stories,
  projectLabel,
  onAdd,
  onDelete,
}: {
  stories: Story[] | undefined;
  /** Story'lerin ait olduğu ay, örn. "Ekim 2026". */
  projectLabel: string | null;
  onAdd: (input: { url: string; mediaType: "image" | "video" }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ordered = sortStories(stories);

  const add = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      const mediaType = file.type.startsWith("video/") ? "video" : "image";
      const { url } = mediaType === "video" ? await loadVideoFile(file) : await loadImageFile(file);
      await onAdd({ url, mediaType });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Story eklenemedi.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const remove = async () => {
    if (!confirmId) return;
    try {
      await onDelete(confirmId);
      setConfirmId(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Story silinemedi.");
      setConfirmId(null);
    }
  };

  return (
    <section aria-label="Story yönetimi">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-neutral-500">
          {projectLabel ? `${projectLabel} planına ait Story'ler.` : "Story eklemek için bir aylık plan seçin."}
        </p>
        <button
          type="button"
          disabled={!projectLabel || busy}
          onClick={() => inputRef.current?.click()}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
        >
          <PlusIcon className="size-4" aria-hidden="true" />
          {busy ? "Yükleniyor..." : "Story Ekle"}
        </button>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,video/mp4,video/webm"
        className="hidden"
        aria-label="Story dosyası seç"
        onChange={(event) => void add(event.target.files?.[0])}
      />
      {ordered.length ? (
        <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-4">
          {ordered.map((story) => (
            <div key={story.id} className="group relative aspect-[9/16] overflow-hidden rounded-lg bg-neutral-200 outline-1 -outline-offset-1 outline-black/10">
              {story.mediaType === "video" ? (
                <video src={story.mediaUrl} muted preload="metadata" className="size-full object-cover" />
              ) : (
                <img src={story.mediaUrl} alt="Story" className="size-full object-cover" />
              )}
              {story.mediaType === "video" ? <PlayIcon className="absolute left-2 top-2 size-4 text-white drop-shadow" aria-hidden="true" /> : null}
              <button
                type="button"
                onClick={() => setConfirmId(story.id)}
                className="absolute inset-x-1 bottom-1 rounded bg-black/65 px-1 py-1 text-xs font-medium text-white opacity-0 transition group-hover:opacity-100 focus:opacity-100"
              >
                Story’yi Sil
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-4 rounded-xl border border-dashed border-slate-300 p-5 text-center text-sm text-neutral-500">
          Bu ay için henüz Story eklenmedi.
        </div>
      )}
      {error ? <p role="alert" className="mt-3 text-sm text-red-700">{error}</p> : null}
      {confirmId ? (
        <div className="fixed inset-0 z-[60] grid place-items-center p-4" role="dialog" aria-modal="true" aria-label="Story’yi Sil">
          <div className="fixed inset-0 bg-black/50" onClick={() => setConfirmId(null)} />
          <div className="relative w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl">
            <h3 className="text-base font-semibold">Story silinsin mi?</h3>
            <p className="mt-2 text-sm text-neutral-600">Yalnız bu Story silinir; diğer aylar ve içerikler etkilenmez.</p>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setConfirmId(null)} className="h-9 rounded-lg border border-slate-200 px-3 text-sm">İptal</button>
              <button type="button" onClick={() => void remove()} className="h-9 rounded-lg bg-red-600 px-3 text-sm font-medium text-white">Story’yi Sil</button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
