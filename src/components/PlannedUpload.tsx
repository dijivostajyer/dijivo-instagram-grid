"use client";

import { useRef, useState } from "react";

import ReelDraftEditor from "./ReelDraftEditor";
import { MAX_VIDEO_BYTES, getMediaSizeAdvisory, loadImageFile } from "@/lib/validators";
import type { PostType } from "@/lib/types";

/** Reel video desteği metni (doğrulama limitiyle aynı kaynak, §3). */
const REEL_HINT = `MP4 veya WebM · Önerilen 1080 × 1920 px (9:16) · Maksimum ${Math.round(MAX_VIDEO_BYTES / (1024 * 1024))} MB · Tek video`;

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
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [postType, setPostType] = useState<PostType>("post");
  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    setError(null);
    setNotice(null);
    setBusy(true);
    const failures: string[] = [];
    const advisories: string[] = [];
    // Her yeni planlanan içerik yayın sırasının başına (planOrder 0)
    // eklendiği için seçilen dosya sırasının korunması üzere batch
    // ters sırada işlenir: ilk seçilen dosya en üstte sona erer.
    const batch = Array.from(files).reverse();
    for (const file of batch) {
      try {
        const { url, alt, aspectRatio, width, height } = await loadImageFile(file);
        const advisory = getMediaSizeAdvisory(width, height, "post");
        if (advisory) advisories.push(`${file.name}: ${advisory}`);
        await onUpload(url, alt, postType, aspectRatio);
      } catch (e) {
        failures.push(`${file.name}: ${e instanceof Error ? e.message : "Görsel yüklenemedi."}`);
      }
    }
    if (failures.length) {
      setError(failures.join(" "));
    }
    if (advisories.length) setNotice(`Boyut önerisi (yükleme yapıldı, dosya değiştirilmedi): ${advisories.join(" ")}`);
    setBusy(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
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
      {postType !== "reel" ? (
        <p className="text-xs text-neutral-400">
          Önerilen boyut: 1080 × 1350 px (4:5).
        </p>
      ) : null}
      {postType === "reel" ? (
        <ReelDraftEditor
          hint={REEL_HINT}
          disabled={busy}
          onAdd={(draft) =>
            onUpload(
              draft.coverUrl ?? draft.posterUrl ?? draft.videoUrl,
              draft.coverUrl ? (draft.coverAlt ?? draft.videoName) : draft.videoName,
              "reel",
              "1:1",
              { videoUrl: draft.videoUrl, coverImageUrl: draft.coverUrl },
            )
          }
        />
      ) : null}
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
