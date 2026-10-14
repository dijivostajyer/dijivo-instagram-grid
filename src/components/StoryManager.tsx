"use client";

import { useRef, useState } from "react";
import { PlayIcon, PlusIcon } from "@heroicons/react/16/solid";

import { loadImageFile, loadVideoFile } from "@/lib/validators";
import type { Brand, Story } from "@/lib/types";

export default function StoryManager({ brand, onChange, onDelete }: { brand: Brand; onChange: (next: Brand) => void; onDelete: (id: string) => Promise<void> }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stories = [...(brand.stories ?? [])].sort((left, right) => left.sortOrder - right.sortOrder);
  const add = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    try {
      const result = file.type.startsWith("video/") ? await loadVideoFile(file) : await loadImageFile(file);
      const story: Story = { id: `story-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, mediaType: file.type.startsWith("video/") ? "video" : "image", mediaUrl: result.url, createdAt: new Date().toISOString(), sortOrder: stories.length };
      onChange({ ...brand, stories: [...stories, story] });
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Story eklenemedi."); }
    finally { if (inputRef.current) inputRef.current.value = ""; }
  };
  const remove = async () => {
    if (!confirmId) return;
    try { await onDelete(confirmId); setConfirmId(null); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Story silinemedi."); }
  };
  return <section className="mt-6 rounded-xl border border-slate-200 bg-slate-50/70 p-4" aria-label="Story yönetimi">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-sm font-semibold text-neutral-900">Story’ler</h2><p className="mt-1 text-xs text-neutral-500">Profil fotoğrafından açılan, marka bazlı geçici içerikler.</p></div><button type="button" onClick={() => inputRef.current?.click()} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"><PlusIcon className="size-4" />Story Ekle</button></div>
    <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/webm" className="hidden" onChange={(event) => void add(event.target.files?.[0])} />
    {stories.length ? <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-4">{stories.map((story) => <div key={story.id} className="group relative aspect-[9/16] overflow-hidden rounded-lg bg-neutral-200 outline-1 -outline-offset-1 outline-black/10">{story.mediaType === "video" ? <video src={story.mediaUrl} muted preload="metadata" className="size-full object-cover" /> : <img src={story.mediaUrl} alt="Story" className="size-full object-cover" />}{story.mediaType === "video" ? <PlayIcon className="absolute left-2 top-2 size-4 text-white drop-shadow" /> : null}<button type="button" onClick={() => setConfirmId(story.id)} className="absolute inset-x-1 bottom-1 rounded bg-black/65 px-1 py-1 text-xs font-medium text-white opacity-0 transition group-hover:opacity-100 focus:opacity-100">Story’yi Sil</button></div>)}</div> : <p className="mt-4 text-sm text-neutral-500">Henüz Story eklenmedi.</p>}
    {error ? <p role="alert" className="mt-3 text-sm text-red-700">{error}</p> : null}
    {confirmId ? <div className="fixed inset-0 z-[60] grid place-items-center p-4" role="dialog" aria-modal="true" aria-label="Story’yi Sil"><div className="fixed inset-0 bg-black/50" onClick={() => setConfirmId(null)} /><div className="relative w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl"><h3 className="text-base font-semibold">Story silinsin mi?</h3><p className="mt-2 text-sm text-neutral-600">Yalnız bu Story silinir; marka ve diğer içerikler etkilenmez.</p><div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setConfirmId(null)} className="h-9 rounded-lg border border-slate-200 px-3 text-sm">İptal</button><button type="button" onClick={() => void remove()} className="h-9 rounded-lg bg-red-600 px-3 text-sm font-medium text-white">Story’yi Sil</button></div></div></div> : null}
  </section>;
}
