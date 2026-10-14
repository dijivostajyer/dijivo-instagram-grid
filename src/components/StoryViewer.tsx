"use client";

import { useEffect, useRef, useState } from "react";
import { XMarkIcon } from "@heroicons/react/16/solid";

import type { Brand, Story } from "@/lib/types";

const IMAGE_DURATION_MS = 5_000;

export default function StoryViewer({ brand, stories, onClose }: { brand: Brand; stories: Story[]; onClose: () => void }) {
  const ordered = [...stories].sort((left, right) => left.sortOrder - right.sortOrder);
  const [index, setIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const [closing, setClosing] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const story = ordered[index];

  const close = () => {
    setClosing(true);
    window.setTimeout(onClose, 160);
  };
  const move = (direction: -1 | 1) => {
    const next = index + direction;
    if (next < 0) setIndex(0);
    else if (next >= ordered.length) close();
    else setIndex(next);
  };

  useEffect(() => {
    setProgress(0);
    if (!story || story.mediaType !== "image") return;
    const started = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const value = Math.min(1, (now - started) / IMAGE_DURATION_MS);
      setProgress(value);
      if (value < 1) frame = requestAnimationFrame(tick);
      else move(1);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
    // Yalnız aktif Story değiştiğinde sayaç sıfırlanır.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, story?.id]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
      if (event.key === "ArrowLeft") move(-1);
      if (event.key === "ArrowRight") move(1);
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, ordered.length]);

  if (!story) return null;
  return (
    <div className={`fixed inset-0 z-[60] grid place-items-center bg-black/90 p-3 transition-opacity duration-150 ${closing ? "opacity-0" : "opacity-100"}`} role="dialog" aria-modal="true" aria-label="Story önizlemesi">
      <div className={`relative h-[min(84vh,720px)] w-[min(94vw,405px)] overflow-hidden rounded-2xl bg-neutral-950 shadow-2xl transition duration-150 ${closing ? "translate-y-2 scale-95" : "translate-y-0 scale-100"}`}>
        <div className="absolute inset-x-3 top-3 z-20 flex gap-1" aria-label="Story ilerlemesi">
          {ordered.map((item, itemIndex) => (
            <span key={item.id} className="h-1 flex-1 overflow-hidden rounded-full bg-white/30">
              <span className="block h-full bg-white transition-[width] duration-100" style={{ width: `${itemIndex < index ? 100 : itemIndex === index ? progress * 100 : 0}%` }} />
            </span>
          ))}
        </div>
        <header className="absolute inset-x-4 top-7 z-20 flex items-center gap-2 text-white">
          {brand.profileImageUrl ? <img src={brand.profileImageUrl} alt="" className="size-8 rounded-full object-cover outline-1 -outline-offset-1 outline-white/30" /> : <span className="grid size-8 place-items-center rounded-full bg-white/20 text-sm font-semibold">{brand.name.charAt(0)}</span>}
          <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{brand.name}</p><p className="truncate text-xs text-white/75">@{brand.username}</p></div>
          <button type="button" onClick={close} className="grid size-9 place-items-center rounded-full bg-black/20 text-white hover:bg-black/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white" aria-label="Story kapat"><XMarkIcon className="size-5" /></button>
        </header>
        {story.mediaType === "video" ? (
          <video ref={videoRef} key={story.id} src={story.mediaUrl} autoPlay muted playsInline preload="metadata" className="size-full object-contain" onTimeUpdate={(event) => { const video = event.currentTarget; if (Number.isFinite(video.duration) && video.duration > 0) setProgress(Math.min(1, video.currentTime / video.duration)); }} onEnded={() => move(1)} />
        ) : <img src={story.mediaUrl} alt="Story" className="size-full object-contain" />}
        <button type="button" aria-label="Önceki Story" onClick={() => move(-1)} className="absolute inset-y-0 left-0 z-10 w-1/3 cursor-w-resize" />
        <button type="button" aria-label="Sonraki Story" onClick={() => move(1)} className="absolute inset-y-0 right-0 z-10 w-1/3 cursor-e-resize" />
      </div>
    </div>
  );
}
