"use client";

import { useEffect, useRef, useState } from "react";

import {
  createVideoPoster,
  getMediaSizeAdvisory,
  loadCoverFile,
  loadVideoFile,
  safeRevokeObjectUrl,
} from "@/lib/validators";

/** Kullanıcının "Reel ekle"ye bastığı anda üst bileşene verilen taslak. */
export interface ReelDraft {
  videoUrl: string;
  videoName: string;
  /** Kullanıcının yüklediği kapak; yoksa tanımsız. */
  coverUrl?: string;
  coverAlt?: string;
  /**
   * Kapak yokken videonun ilk karesinden üretilen AYRI görsel (grid küçük
   * görseli). Kapak değildir; üretilemezse tanımsızdır.
   */
  posterUrl?: string;
}

/**
 * Reel taslağı: video + isteğe bağlı kapak seçimi, taslak önizlemesi,
 * değiştirme / kaldırma, boyut uyarıları ve hata gösterimi. Video dosyası
 * hiçbir zaman kırpılmaz, yeniden kodlanmaz veya değiştirilmez.
 * Eklenmeyen taslak URL'leri iptal edilir (bellek sızıntısı yok).
 */
export default function ReelDraftEditor({
  hint,
  onAdd,
  disabled = false,
}: {
  hint: string;
  onAdd: (draft: ReelDraft) => Promise<void> | void;
  disabled?: boolean;
}) {
  const coverInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const [cover, setCover] = useState<{ url: string; alt: string } | null>(null);
  const [video, setVideo] = useState<{ url: string; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Henüz üst bileşene teslim edilmemiş (sahipsiz) taslak URL'leri.
  const liveUrls = useRef(new Set<string>());

  useEffect(() => {
    const urls = liveUrls.current;
    return () => {
      for (const url of urls) safeRevokeObjectUrl(url);
      urls.clear();
    };
  }, []);

  function release(url: string | undefined) {
    if (!url) return;
    liveUrls.current.delete(url);
    safeRevokeObjectUrl(url);
  }

  async function chooseVideo(file: File | undefined) {
    if (!file) return;
    setError(null);
    try {
      const { url, width, height } = await loadVideoFile(file);
      liveUrls.current.add(url);
      release(video?.url);
      setVideo({ url, name: file.name });
      const advisory = getMediaSizeAdvisory(width, height, "reel");
      setNotice(advisory ? `Boyut önerisi (video yüklendi, dosya değiştirilmedi): ${advisory}` : null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Video yüklenemedi.");
    } finally {
      if (videoInputRef.current) videoInputRef.current.value = "";
    }
  }

  async function chooseCover(file: File | undefined) {
    if (!file) return;
    setError(null);
    try {
      const { url, alt, width, height } = await loadCoverFile(file);
      liveUrls.current.add(url);
      release(cover?.url);
      setCover({ url, alt });
      const advisory = getMediaSizeAdvisory(width, height, "reel");
      setNotice(advisory ? `Kapak boyut önerisi (dosya değiştirilmedi): ${advisory}` : null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Kapak görseli yüklenemedi.");
    } finally {
      if (coverInputRef.current) coverInputRef.current.value = "";
    }
  }

  function removeVideo() {
    release(video?.url);
    setVideo(null);
    setNotice(null);
    setError(null);
  }

  function removeCover() {
    release(cover?.url);
    setCover(null);
    setError(null);
  }

  async function add() {
    if (!video) return;
    setError(null);
    setBusy(true);
    let posterUrl: string | undefined;
    try {
      if (!cover) {
        const poster = await createVideoPoster(video.url);
        posterUrl = poster?.url;
        if (poster) liveUrls.current.add(poster.url);
      }
      await onAdd({
        videoUrl: video.url,
        videoName: video.name,
        coverUrl: cover?.url,
        coverAlt: cover?.alt,
        posterUrl,
      });
      // Teslim edilen URL'ler artık üst bileşene aittir; burada iptal edilmez.
      for (const url of [video.url, cover?.url, posterUrl]) if (url) liveUrls.current.delete(url);
      setVideo(null);
      setCover(null);
      setNotice(
        !cover && !posterUrl
          ? "Videodan otomatik görsel alınamadı; grid görseli için kapak yüklemeniz önerilir."
          : null,
      );
    } catch (e) {
      release(posterUrl);
      setError(e instanceof Error ? e.message : "Reel eklenemedi.");
    } finally {
      setBusy(false);
    }
  }

  const buttonClass =
    "inline-flex h-8 items-center rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600";

  return (
    <div className="mt-2 rounded-xl border border-slate-200 p-3">
      <p className="mb-2 text-xs font-medium text-neutral-500">{hint}</p>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => coverInputRef.current?.click()} disabled={busy || disabled} className={buttonClass}>
          {cover ? "Kapak değiştir" : "Kapak görseli yükle"}
        </button>
        <button type="button" onClick={() => videoInputRef.current?.click()} disabled={busy || disabled} className={buttonClass}>
          {video ? "Videoyu değiştir" : "Video dosyası yükle"}
        </button>
        {cover ? (
          <button type="button" onClick={removeCover} disabled={busy} className={buttonClass}>
            Kapağı kaldır
          </button>
        ) : null}
        {video ? (
          <button type="button" onClick={removeVideo} disabled={busy} className={buttonClass}>
            Videoyu kaldır
          </button>
        ) : null}
      </div>
      <div className="flex flex-wrap items-start gap-3">
        {video ? (
          <div className="grid gap-1">
            {/* Taslak önizlemesi: autoplay yok, kontroller açık. */}
            <video
              key={video.url}
              src={video.url}
              controls
              muted
              playsInline
              preload="metadata"
              aria-label="Reel video önizlemesi (taslak)"
              className="max-h-56 w-auto max-w-full rounded-lg bg-black"
            />
            <span className="max-w-48 truncate text-xs text-neutral-600">{video.name}</span>
          </div>
        ) : null}
        {cover ? (
          <div className="grid gap-1">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={cover.url} alt="Reel kapak önizlemesi" className="max-h-56 w-auto max-w-full rounded-lg bg-neutral-100 object-contain outline-1 -outline-offset-1 outline-black/10" />
            <span className="text-xs text-neutral-500">Kapak</span>
          </div>
        ) : null}
        <button
          type="button"
          onClick={() => void add()}
          disabled={!video || busy || disabled}
          className="inline-flex h-8 items-center rounded-lg bg-neutral-900 px-3 text-xs font-semibold text-white hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
        >
          Reel ekle
        </button>
      </div>
      {video && !cover ? (
        <p className="mt-2 text-xs text-neutral-500">Kapak yüklemezseniz grid görseli videonun ilk karesinden otomatik oluşturulur.</p>
      ) : null}
      <input ref={coverInputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => void chooseCover(e.target.files?.[0])} />
      <input ref={videoInputRef} type="file" accept="video/mp4,video/webm" className="hidden" onChange={(e) => void chooseVideo(e.target.files?.[0])} />
      {notice ? (
        <p role="status" className="mt-2 text-xs text-amber-700">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-2 text-xs font-medium text-red-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}
