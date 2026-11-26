"use client";

import { useEffect, useState, type RefObject } from "react";

type MediaTab = "video" | "cover";

/**
 * Reel detay medyası: video oynatıcı ve (varsa) kapak görseli ayrı sekmelerde.
 * Kapak yoksa yalnız video gösterilir (sekme çubuğu çıkmaz). Her iki medya da
 * kendi gerçek oranında, kırpılmadan (`object-contain`) gösterilir.
 * Video sekmesinden çıkınca oynatma durur; autoplay yoktur.
 */
export default function ReelVideoWithCover({
  videoUrl,
  coverUrl,
  title,
  videoRef,
  videoAriaLabel,
  onVideoError,
}: {
  videoUrl: string;
  /** Ayrı kapak görseli; yoksa sekme çubuğu gösterilmez. */
  coverUrl?: string;
  title: string;
  videoRef: RefObject<HTMLVideoElement | null>;
  videoAriaLabel: string;
  onVideoError: () => void;
}) {
  const [tab, setTab] = useState<MediaTab>("video");
  const hasCover = Boolean(coverUrl);

  // Başka bir içeriğe geçilince veya kapak kalkınca video sekmesine dön.
  useEffect(() => setTab("video"), [videoUrl, coverUrl]);

  function select(next: MediaTab) {
    if (next === tab) return;
    if (next === "cover") videoRef.current?.pause();
    setTab(next);
  }

  const activeTab: MediaTab = hasCover ? tab : "video";
  const tabClass = (value: MediaTab) =>
    `rounded-full px-3 py-1 text-xs font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600 ${
      activeTab === value ? "bg-white text-neutral-900" : "bg-white/15 text-white hover:bg-white/25"
    }`;

  return (
    <div className="relative w-full bg-black">
      {hasCover ? (
        <div role="tablist" aria-label="Reel medyası" className="flex gap-1.5 px-3 pt-3">
          <button type="button" role="tab" id="reel-tab-video" aria-selected={activeTab === "video"} aria-controls="reel-panel-video" onClick={() => select("video")} className={tabClass("video")}>
            Video
          </button>
          <button type="button" role="tab" id="reel-tab-cover" aria-selected={activeTab === "cover"} aria-controls="reel-panel-cover" onClick={() => select("cover")} className={tabClass("cover")}>
            Kapak
          </button>
        </div>
      ) : null}
      <div id="reel-panel-video" role={hasCover ? "tabpanel" : undefined} aria-labelledby={hasCover ? "reel-tab-video" : undefined} hidden={activeTab !== "video"} className="flex w-full items-center justify-center">
        {/* Autoplay YOK — controls + playsInline; kullanıcı başlatır. */}
        <video
          key={videoUrl}
          ref={videoRef}
          src={videoUrl}
          controls
          playsInline
          preload="metadata"
          className="block max-h-[80vh] w-full aspect-[9/16] object-contain"
          aria-label={videoAriaLabel}
          onError={onVideoError}
        />
      </div>
      {hasCover && coverUrl ? (
        <div id="reel-panel-cover" role="tabpanel" aria-labelledby="reel-tab-cover" hidden={activeTab !== "cover"} className="flex w-full items-center justify-center bg-neutral-100">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={coverUrl} alt={`Reel kapağı: ${title}`} className="block h-auto max-h-[80vh] w-full object-contain" />
        </div>
      ) : null}
    </div>
  );
}
