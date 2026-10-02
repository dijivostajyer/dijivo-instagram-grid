"use client";

import { useRef, useState } from "react";

import {
  MAX_VIDEO_BYTES,
  loadCoverFile,
  loadImageFile,
  loadVideoFile,
} from "@/lib/validators";
import type { PostType } from "@/lib/types";

/** Reel video desteği metni (doğrulama limitiyle aynı kaynak, §3). */
const REEL_HINT = `MP4 veya WebM · Maksimum ${Math.round(MAX_VIDEO_BYTES / (1024 * 1024))} MB · Tek video`;

/**
 * Planlanan gönderi yükleme formu (hata mesajlarıyla).
 *
 * Görsel seçimi çoklu olabilir: her dosya ayrı planlanan içerik
 * oluşturur. Bir dosya geçersizse diğer dosyalar yüklenmeye devam
 * eder; başarısız dosyalar `dosya adı: sebep` biçiminde raporlanır
 * ve tüm batch iptal edilmez.
 */
export default function PlannedUpload({
  onUpload,
}: {
  onUpload: (
    url: string,
    alt: string,
    postType: PostType,
    aspectRatio: "1:1" | "3:4" | "4:3" | "16:9",
    reel?: { videoUrl: string; coverImageUrl?: string },
  ) => Promise<void>;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [postType, setPostType] = useState<PostType>("post");
  // §3: Reel seçildiğinde kapak + video akışı (kapak isteğe bağlı).
  const [pendingCover, setPendingCover] = useState<{ url: string; alt: string } | null>(null);
  const [pendingVideo, setPendingVideo] = useState<{ url: string; name: string } | null>(null);

  function resetReelDraft() {
    setPendingCover(null);
    setPendingVideo(null);
  }

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    setError(null);
    setBusy(true);
    const failures: string[] = [];
    // Her yeni planlanan içerik yayın sırasının başına (planOrder 0)
    // eklendiği için seçilen dosya sırasının korunması üzere batch
    // ters sırada işlenir: ilk seçilen dosya en üstte sona erer.
    const batch = Array.from(files).reverse();
    for (const file of batch) {
      try {
        const { url, alt, aspectRatio } = await loadImageFile(file);
        await onUpload(url, alt, postType, aspectRatio);
      } catch (e) {
        failures.push(`${file.name}: ${e instanceof Error ? e.message : "Görsel yüklenemedi."}`);
      }
    }
    if (failures.length) {
      setError(failures.join(" "));
    }
    setBusy(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleCoverFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    try {
      const { url, alt } = await loadCoverFile(file);
      setPendingCover({ url, alt });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Kapak görseli yüklenemedi.");
    } finally {
      if (coverInputRef.current) coverInputRef.current.value = "";
    }
  }

  async function handleVideoFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    try {
      const { url } = await loadVideoFile(file);
      setPendingVideo({ url, name: file.name });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Video yüklenemedi.");
    } finally {
      if (videoInputRef.current) videoInputRef.current.value = "";
    }
  }

  async function handleAddReel() {
    if (!pendingVideo) return;
    setError(null);
    setBusy(true);
    try {
      await onUpload(
        pendingCover ? pendingCover.url : pendingVideo.url,
        pendingCover ? pendingCover.alt : pendingVideo.name,
        "reel",
        "1:1",
        { videoUrl: pendingVideo.url, coverImageUrl: pendingCover ? pendingCover.url : undefined },
      );
      resetReelDraft();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Reel eklenemedi.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        {postType === "reel" ? null : (
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={busy}
          className="inline-flex h-9 items-center rounded-lg bg-neutral-900 px-3 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
        >
          {busy ? "Yükleniyor…" : "Görsel yükle"}
        </button>
        )}
        <select
          aria-label="Planlanan içerik türü"
          value={postType}
          onChange={(event) => {
            setPostType(event.target.value as PostType);
            resetReelDraft();
          }}
          className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm focus:border-sky-600 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-600"
        >
          <option value="post">Post</option>
          <option value="reel">Reel</option>
          <option value="carousel">Carousel</option>
        </select>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          className="hidden"
          onChange={(e) => void handleFiles(e.target.files)}
        />
      </div>
      {postType !== "reel" ? (
        <p className="mt-1.5 text-xs text-neutral-400">
          Birden fazla JPG, PNG veya WebP seçebilirsiniz.
        </p>
      ) : null}
      {postType === "reel" ? (
        <div className="mt-2 rounded-xl border border-slate-200 p-3">
          <p className="mb-2 text-xs font-medium text-neutral-500">{REEL_HINT}</p>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => coverInputRef.current?.click()}
              className="inline-flex h-8 items-center rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
            >
              {pendingCover ? "Kapak değiştir" : "Kapak görseli yükle"}
            </button>
            <button
              type="button"
              onClick={() => videoInputRef.current?.click()}
              className="inline-flex h-8 items-center rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
            >
              {pendingVideo ? "Videoyu değiştir" : "Video dosyası yükle"}
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {pendingCover ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={pendingCover.url} alt="Reel kapak önizlemesi" className="size-12 rounded-lg object-cover outline-1 -outline-offset-1 outline-black/10" />
            ) : null}
            {pendingVideo ? (
              <span className="max-w-40 truncate rounded-lg bg-neutral-100 px-2 py-1 text-xs text-neutral-600">
                {pendingVideo.name}
              </span>
            ) : null}
            <button
              type="button"
              onClick={() => void handleAddReel()}
              disabled={!pendingVideo || busy}
              className="inline-flex h-8 items-center rounded-lg bg-neutral-900 px-3 text-xs font-semibold text-white hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
            >
              Reel ekle
            </button>
          </div>
          <input
            ref={coverInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => void handleCoverFile(e.target.files?.[0])}
          />
          <input
            ref={videoInputRef}
            type="file"
            accept="video/mp4,video/webm"
            className="hidden"
            onChange={(e) => void handleVideoFile(e.target.files?.[0])}
          />
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="mt-2 text-xs font-medium text-red-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}
