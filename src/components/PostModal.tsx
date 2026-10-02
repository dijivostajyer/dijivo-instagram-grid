"use client";

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import {
  BookmarkIcon,
  ChatBubbleOvalLeftIcon,
  DocumentDuplicateIcon,
  EllipsisHorizontalIcon,
  HeartIcon,
  MoonIcon,
  PaperAirplaneIcon,
  SunIcon,
  TrashIcon,
  XMarkIcon,
} from "@heroicons/react/16/solid";

import {
  type PostCopyOptions,
  type NewBrandInput,
} from "@/hooks/use-persisted-grid";
import { useInstagramPreviewTheme } from "@/lib/ig-preview-theme";
import {
  MAX_VIDEO_BYTES,
  loadCoverFile,
  loadImageFile,
  loadVideoFile,
} from "@/lib/validators";

/** Reel video desteği metni (doğrulama limitiyle aynı kaynak). */
const REEL_HINT = `MP4 veya WebM · Maksimum ${Math.round(MAX_VIDEO_BYTES / (1024 * 1024))} MB`;
import type { GridProject } from "@/lib/storage";
import type {
  Brand,
  ExistingPost,
  PlannedPost,
  PostType,
} from "@/lib/types";

type Source = "mevcut" | "planlanan";

/**
 * İçerik detay modalı (§11/§12): gridden veya içerik listesinden
 * bir gönderi seçildiğinde dimlenmiş arka plan üzerinde ortalanmış
 * açılır. Masaüstünde önizleme|düzenleyici iki sütun; mobilde
 * tek sütun. Escape ve arka plan tıklaması kapatır.
 */
export default function PostModal({
  post,
  source,
  brand,
  allProjects,
  brands,
  onPostTypeChange,
  onCaptionChange,
  onTogglePin,
  onMovePinned,
  onDelete,
  onChangeImage,
  onChangeVideo,
  onChangeCover,
  onCopy,
  onClose,
}: {
  post: ExistingPost | PlannedPost;
  /** Yalnızca pin görünürlüğü gibi iş kuralları için; arayüzde gösterilmez. */
  source: Source;
  brand: Brand;
  /** Kopya hedefi seçici için tüm projeler (tüm markalar). */
  allProjects: GridProject[];
  /** Hedef marka adları için marka kayıt defteri. */
  brands: Brand[];
  onPostTypeChange: (postType: PostType) => void;
  onCaptionChange: (caption: string) => void;
  onTogglePin?: () => void;
  onMovePinned?: (direction: -1 | 1) => void;
  onDelete?: () => void;
  onChangeImage: (url: string) => Promise<void>;
  /** §7: Reel videosu değiştir (GridManager video-store'a kalıcılaştırır). */
  onChangeVideo?: (url: string) => Promise<void>;
  /** §7: Reel kapak görseli değiştir. */
  onChangeCover?: (url: string) => Promise<void>;
  onCopy: (targetProjectId: string, options: PostCopyOptions) => string | null;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [copyTarget, setCopyTarget] = useState("");
  const [copyOptions, setCopyOptions] = useState<PostCopyOptions>({
    caption: true,
    postType: true,
    hashtags: true,
    pinned: false,
  });
  const [copyError, setCopyError] = useState<string | null>(null);
  const [imageBusy, setImageBusy] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const [theme, toggleTheme] = useInstagramPreviewTheme();
  const dark = theme === "dark";
  // §7: Reel durumu — video varsa modal video önizlemesi açar.
  const isReel = post.mediaType === "video" && Boolean(post.videoUrl);
  const videoRef = useRef<HTMLVideoElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const [videoBusy, setVideoBusy] = useState(false);
  const [mediaError, setMediaError] = useState<string | null>(null);

  // §7/§11: modal kapanınca video playback durur, timeline sıfırlanır.
  function stopVideo() {
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.currentTime = 0;
    }
  }

  function handleClose() {
    stopVideo();
    onClose();
  }

  useEffect(() => {
    return () => {
      if (videoRef.current) videoRef.current.pause();
    };
  }, []);

  async function handleVideoChange(files: FileList | null) {
    if (!files?.length) return;
    setMediaError(null);
    setVideoBusy(true);
    try {
      const { url } = await loadVideoFile(files[0]);
      await onChangeVideo?.(url);
    } catch (e) {
      setMediaError(e instanceof Error ? e.message : "Video değiştirilemedi.");
    } finally {
      setVideoBusy(false);
      if (videoInputRef.current) videoInputRef.current.value = "";
    }
  }

  async function handleCoverChange(files: FileList | null) {
    if (!files?.length) return;
    setMediaError(null);
    setVideoBusy(true);
    try {
      const { url } = await loadCoverFile(files[0]);
      await onChangeCover?.(url);
    } catch (e) {
      setMediaError(e instanceof Error ? e.message : "Kapak değiştirilemedi.");
    } finally {
      setVideoBusy(false);
      if (coverInputRef.current) coverInputRef.current.value = "";
    }
  }

  useEffect(() => {
    closeRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        stopVideo();
        onClose();
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  const pinned = source === "mevcut" && (post as ExistingPost).pinned;
  const title = post.alt ?? "Görsel";
  const caption = post.caption ?? "";

  function appendToCaption(text: string) {
    onCaptionChange(caption ? `${caption}\n\n${text}` : text);
  }

  function appendMention(mention: string) {
    const handle = mention.startsWith("@") ? mention : `@${mention}`;
    onCaptionChange(
      caption && !caption.endsWith(" ") && caption.length > 0
        ? `${caption} ${handle}`
        : `${caption}${handle}`,
    );
  }

  async function handleImageChange(files: FileList | null) {
    if (!files?.length) return;
    setImageError(null);
    setImageBusy(true);
    try {
      const { url } = await loadImageFile(files[0]);
      await onChangeImage(url);
    } catch (e) {
      setImageError(e instanceof Error ? e.message : "Görsel değiştirilemedi.");
    } finally {
      setImageBusy(false);
      if (imageInputRef.current) imageInputRef.current.value = "";
    }
  }

  function handleCopy(event: FormEvent) {
    event.preventDefault();
    if (!copyTarget) return;
    const error = onCopy(copyTarget, copyOptions);
    if (error) {
      setCopyError(error);
      return;
    }
    onClose();
  }

  function handleDelete() {
    if (
      window.confirm(
        `"${title}" içeriği silinsin mi? Bu işlem geri alınamaz.`,
      )
    ) {
      onDelete?.();
    }
  }

  const darkSurface = dark ? "bg-[#0a0a0a]" : "bg-white";
  const darkText = dark ? "text-neutral-100" : "text-neutral-900";
  const darkMuted = dark ? "text-neutral-400" : "text-neutral-500";
  const darkBorder = dark ? "border-neutral-800" : "border-slate-200";

  const captionParts = caption.split(/(#[\p{L}\d_]+)/gu);

  const brandForProject = (project: GridProject) =>
    brands.find((item) => item.id === project.brandId)?.name ??
    "Bu marka";

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center overflow-y-auto p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`İçeriği düzenle: ${title}`}
    >
      <div
        className="fixed inset-0 bg-black/50"
        onClick={handleClose}
        aria-hidden="true"
      />
      <div className="relative my-6 grid w-full max-w-5xl overflow-hidden rounded-2xl bg-white shadow-2xl lg:grid-cols-2">
        {/* Sol sütun: Instagram gönderi önizlemesi (§13) */}
        <div
          className={`flex flex-col ${dark ? "bg-black text-neutral-100" : "bg-white text-neutral-900"}`}
        >
          <div className="flex items-center justify-between gap-2 border-b border-neutral-800/20 px-4 py-3">
            <div className="flex min-w-0 items-center gap-2.5">
              {brand.profileImageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={brand.profileImageUrl}
                  alt={brand.name}
                  className="size-8 rounded-full object-cover outline-1 -outline-offset-1 outline-black/10"
                />
              ) : (
                <span className="grid size-8 place-items-center rounded-full bg-neutral-200 text-sm font-semibold text-neutral-600">
                  {brand.name.charAt(0).toUpperCase()}
                </span>
              )}
              <span className="truncate text-sm font-semibold">
                {brand.username}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={toggleTheme}
                aria-label={dark ? "Açık mode geç" : "Koyu mode geç"}
                className="grid size-8 place-items-center rounded-lg text-neutral-500 hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
              >
                {dark ? (
                  <SunIcon className="size-5" aria-hidden="true" />
                ) : (
                  <MoonIcon className="size-5" aria-hidden="true" />
                )}
              </button>
              <EllipsisHorizontalIcon
                className="size-5 text-neutral-500"
                aria-hidden="true"
              />
            </div>
          </div>

          {isReel && post.videoUrl ? (
            <div className="relative aspect-square w-full bg-black">
              {/* §7: autoplay YOK — controls + playsInline; kullanıcı başlatır. */}
              <video
                key={post.videoUrl}
                ref={videoRef}
                src={post.videoUrl}
                controls
                playsInline
                preload="metadata"
                className="absolute inset-0 size-full object-contain"
                aria-label="Reel video önizlemesi"
              />
            </div>
          ) : (
            <div className="relative aspect-square w-full bg-neutral-100">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={post.imageUrl}
                alt={title}
                className="absolute inset-0 size-full object-cover"
              />
            </div>
          )}

          <div className="flex items-center gap-3 px-4 pt-3">
            <HeartIcon className="size-6" aria-hidden="true" />
            <ChatBubbleOvalLeftIcon className="size-6" aria-hidden="true" />
            <PaperAirplaneIcon className="size-6" aria-hidden="true" />
            <span className="flex-1" />
            <BookmarkIcon className="size-6" aria-hidden="true" />
          </div>
          <p className="px-4 pt-2 pb-4 text-sm leading-relaxed">
            <span className="font-semibold">{brand.username}</span>{" "}
            {captionParts.map((part, index) =>
              part.startsWith("#") ? (
                <span
                  key={index}
                  className="text-sky-700 dark:text-sky-400"
                >
                  {part}{" "}
                </span>
              ) : (
                <span key={index}>{part}</span>
              ),
            )}
          </p>
        </div>

        {/* Sağ sütun: düzenleyici (§12) */}
        <div className="flex max-h-[85vh] flex-col overflow-y-auto p-5 sm:p-6">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h2 className={`text-base font-semibold ${darkText}`}>
                İçeriği Düzenle
              </h2>
              <p className={`mt-0.5 text-sm ${darkMuted}`}>
                @{brand.username}
              </p>
            </div>            <button
                ref={closeRef}
                type="button"
                onClick={handleClose}
                aria-label="Kapat"
              className="grid size-9 shrink-0 place-items-center rounded-lg text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
            >
              <XMarkIcon className="size-5" aria-hidden="true" />
            </button>
          </div>

          <div className="space-y-5">
            {/* Görsel / Reel (§7) */}
            <div>
              <span className={`mb-1.5 block text-xs font-medium ${darkMuted}`}>
                {isReel ? "Reel" : "Görsel"}
              </span>
              <div className="flex items-center gap-3">
                <div className="size-16 shrink-0 overflow-hidden rounded-lg bg-neutral-100 outline-1 -outline-offset-1 outline-black/10">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={isReel ? (post.coverImageUrl ?? post.imageUrl) : post.imageUrl}
                    alt={title}
                    className="size-full object-cover"
                  />
                </div>
                <div>
                  {isReel ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => videoInputRef.current?.click()}
                        disabled={videoBusy}
                        className="inline-flex h-9 items-center rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
                      >
                        {videoBusy ? "Yükleniyor…" : "Videoyu değiştir"}
                      </button>
                      <button
                        type="button"
                        onClick={() => coverInputRef.current?.click()}
                        disabled={videoBusy}
                        className="inline-flex h-9 items-center rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
                      >
                        Kapak değiştir
                      </button>
                      <span className="text-xs text-neutral-500">{REEL_HINT}</span>
                      <input
                        ref={videoInputRef}
                        type="file"
                        accept="video/mp4,video/webm"
                        className="hidden"
                        onChange={(event: ChangeEvent<HTMLInputElement>) =>
                          void handleVideoChange(event.target.files)
                        }
                      />
                      <input
                        ref={coverInputRef}
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        className="hidden"
                        onChange={(event: ChangeEvent<HTMLInputElement>) =>
                          void handleCoverChange(event.target.files)
                        }
                      />
                    </div>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => imageInputRef.current?.click()}
                        disabled={imageBusy}
                        className="inline-flex h-9 items-center rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
                      >
                        {imageBusy ? "Yükleniyor…" : "Görseli değiştir"}
                      </button>
                      <input
                        ref={imageInputRef}
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        className="hidden"
                        onChange={(event: ChangeEvent<HTMLInputElement>) =>
                          void handleImageChange(event.target.files)
                        }
                      />
                    </>
                  )}
                  {mediaError ? (
                    <p role="alert" className="mt-1 text-xs font-medium text-red-600">
                      {mediaError}
                    </p>
                  ) : null}
                  {imageError ? (
                    <p role="alert" className="mt-1 text-xs font-medium text-red-600">
                      {imageError}
                    </p>
                  ) : null}
                </div>
              </div>
            </div>

            {/* İçerik türü */}
            <div>
              <label
                htmlFor="modal-post-type"
                className={`mb-1.5 block text-xs font-medium ${darkMuted}`}
              >
                İçerik türü
              </label>
              <select
                id="modal-post-type"
                value={post.postType ?? "post"}
                onChange={(event) =>
                  onPostTypeChange(event.target.value as PostType)
                }
                className={`h-9 w-full rounded-lg border px-2 text-sm outline-none focus:border-sky-600 ${darkBorder} ${darkSurface} ${darkText}`}
              >
                <option value="post">Post</option>
                <option value="reel">Reel</option>
                <option value="carousel">Carousel</option>
              </select>
            </div>

            {/* Caption (§10) */}
            <div>
              <label
                htmlFor="modal-caption"
                className={`mb-1.5 block text-xs font-medium ${darkMuted}`}
              >
                Caption
              </label>
              <textarea
                id="modal-caption"
                value={caption}
                onChange={(event) => onCaptionChange(event.target.value)}
                rows={5}
                placeholder="Gönderi açıklaması; #hashtag ve @mention doğrudan yazılabilir."
                className={`w-full rounded-lg border px-2.5 py-2 text-sm outline-none focus:border-sky-600 ${darkBorder} ${darkSurface} ${darkText}`}
              />
              <p className={`mt-1 text-xs ${darkMuted}`}>
                Hashtag ve mention'ları buraya doğrudan yazabilirsiniz.
              </p>
            </div>

            {/* Hashtag grupları (§8) */}
            {(brand.hashtagGroups ?? []).length > 0 ? (
              <div>
                <span className={`mb-1.5 block text-xs font-medium ${darkMuted}`}>
                  Hashtag grupları
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {brand.hashtagGroups?.map((group) => (
                    <button
                      key={group.id}
                      type="button"
                      onClick={() => appendToCaption(group.tags.join(" "))}
                      title={group.tags.join(" ")}
                      className="h-7 rounded-full border border-slate-200 bg-white px-2.5 text-xs font-medium text-sky-700 hover:bg-sky-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
                    >
                      {group.title}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {/* Mention'lar (§9) */}
            {(brand.defaultMentions ?? []).length > 0 ? (
              <div>
                <span className={`mb-1.5 block text-xs font-medium ${darkMuted}`}>
                  Mention'lar
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {brand.defaultMentions?.map((mention) => (
                    <button
                      key={mention}
                      type="button"
                      onClick={() => appendMention(mention)}
                      className="h-7 rounded-full border border-slate-200 bg-white px-2.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
                    >
                      {mention.startsWith("@") ? mention : `@${mention}`}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {/* CTA'lar (§9) */}
            {(brand.defaultCtas ?? []).length > 0 ? (
              <div>
                <span className={`mb-1.5 block text-xs font-medium ${darkMuted}`}>
                  CTA şablonları
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {brand.defaultCtas?.map((cta) => (
                    <button
                      key={cta}
                      type="button"
                      onClick={() => appendToCaption(cta)}
                      className="h-7 rounded-full border border-slate-200 bg-white px-2.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
                    >
                      {cta}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {/* Pin (§12) */}
            {source === "mevcut" && onTogglePin ? (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={onTogglePin}
                  className={`inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600 ${
                    pinned
                      ? "border-amber-200 bg-amber-50 text-amber-800"
                      : "border-slate-200 bg-white text-neutral-700 hover:bg-neutral-50"
                  }`}
                >
                  <BookmarkIcon className="size-4" aria-hidden="true" />
                  {pinned ? "Pin kaldır" : "Pinle"}
                </button>
                {pinned && onMovePinned ? (
                  <>
                    <button
                      type="button"
                      onClick={() => onMovePinned(-1)}
                      aria-label="Pinned sırasında sola taşı"
                      className="grid size-9 place-items-center rounded-lg border border-slate-200 bg-white text-sm hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
                    >
                      ←
                    </button>
                    <button
                      type="button"
                      onClick={() => onMovePinned(1)}
                      aria-label="Pinned sırasında sağa taşı"
                      className="grid size-9 place-items-center rounded-lg border border-slate-200 bg-white text-sm hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
                    >
                      →
                    </button>
                  </>
                ) : null}
              </div>
            ) : null}

            {/* Kopyala (§16) */}
            <form
              onSubmit={handleCopy}
              className={`rounded-xl border p-4 ${darkBorder} ${darkSurface}`}
            >
              <div className="mb-2 flex items-center gap-1.5">
                <DocumentDuplicateIcon
                  className={`size-4 ${darkMuted}`}
                  aria-hidden="true"
                />
                <span className={`text-sm font-semibold ${darkText}`}>
                  Başka bir plana kopyala
                </span>
              </div>
              <label
                htmlFor="copy-target"
                className={`mb-1.5 block text-xs font-medium ${darkMuted}`}
              >
                Hedef proje
              </label>
              <select
                id="copy-target"
                value={copyTarget}
                onChange={(event) => {
                  setCopyTarget(event.target.value);
                  setCopyError(null);
                }}
                className={`h-9 w-full rounded-lg border px-2 text-sm outline-none focus:border-sky-600 ${darkBorder} ${darkSurface} ${darkText}`}
              >
                <option value="">Proje seçin…</option>
                {allProjects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {brandForProject(project)} › {project.name} (
                    {project.month}/{project.year})
                  </option>
                ))}
              </select>
              <fieldset className="mt-3 grid grid-cols-2 gap-1.5">
                <legend className={`sr-only`}>Kopyalanacak alanlar</legend>
                {(
                  [
                    ["caption", "Caption"],
                    ["postType", "İçerik türü"],
                    ["hashtags", "Hashtag grupları"],
                    ["pinned", "Pin durumu"],
                  ] as const
                ).map(([key, label]) => (
                  <label
                    key={key}
                    className={`inline-flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm ${darkText}`}
                  >
                    <input
                      type="checkbox"
                      checked={copyOptions[key]}
                      onChange={(event) =>
                        setCopyOptions((options) => ({
                          ...options,
                          [key]: event.target.checked,
                        }))
                      }
                      className="size-4 rounded border-slate-300 text-sky-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
                    />
                    {label}
                  </label>
                ))}
              </fieldset>
              {copyError ? (
                <p role="alert" className="mt-2 text-xs font-medium text-red-600">
                  {copyError}
                </p>
              ) : null}
              <button
                type="submit"
                disabled={!copyTarget}
                className="mt-3 inline-flex h-9 items-center rounded-lg bg-sky-700 px-3 text-sm font-semibold text-white hover:bg-sky-800 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
              >
                Kopyala
              </button>
            </form>

            {/* Sil: yıkıcı aksiyon, ana düzenleme alanından ayrılır */}
            <div className="border-t border-slate-200 pt-4 dark:border-neutral-800">
              <button
                type="button"
                onClick={handleDelete}
                className="inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 text-sm font-semibold text-red-700 hover:bg-red-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600"
              >
                <TrashIcon className="size-4" aria-hidden="true" />
                İçeriği sil
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
