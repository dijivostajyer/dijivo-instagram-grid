"use client";

import { useEffect, useRef } from "react";
import {
  BookmarkIcon,
  ChatBubbleOvalLeftIcon,
  HeartIcon,
  PaperAirplaneIcon,
  PlayIcon,
  RectangleStackIcon,
  XMarkIcon,
} from "@heroicons/react/16/solid";

import { useInstagramPreviewTheme } from "@/lib/ig-preview-theme";
import type { Brand, ExistingPost, PlannedPost } from "@/lib/types";

/**
 * Salt-okunur paylaşım gönderi modalı (Phase 2, §9/§10/§17).
 * `/share/[token]` gridinde bir hücreye tıklandığında açılır:
 * masaüstünde büyük medya | avatar/@username/caption/ikonlar,
 * mobilde avatar → medya → ikonlar → caption sırası.
 *
 * Reel'ler için `<video controls playsInline>` oynatıcı açılır
 * (§11): autoplay YOK, kapanınca playback durur ve timeline
 * sıfırlanır. Düzenleme/silme/kopyalama/pin/yer değiştirme
 * kontrolü yoktur — tamamen salt-okunurdur.
 */
export default function SharePostModal({
  post,
  brand,
  onClose,
}: {
  post: ExistingPost | PlannedPost;
  /** Modal başlığı için marka kimliği (avatar + @username). */
  brand: Pick<Brand, "name" | "username" | "profileImageUrl">;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [theme] = useInstagramPreviewTheme();
  const dark = theme === "dark";

  // Reel medya durumu; video URL'i olmayan eski reel kayıtları
  // görsel gönderi gibi açılır (§4/§5 güvenli fallback).
  const isReel = post.mediaType === "video" && Boolean(post.videoUrl);
  const title = post.alt ?? post.id;
  const caption = post.caption ?? "";
  const captionParts = caption.split(/(#[\p{L}\d_]+)/gu);

  // §11: modal kapanınca video durur, playback baştan başlar.
  function stopVideo() {
    const video = videoRef.current;
    if (video) {
      video.pause();
      video.currentTime = 0;
    }
  }

  function handleClose() {
    stopVideo();
    onClose();
  }

  useEffect(() => {
    closeRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") handleClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      if (videoRef.current) videoRef.current.pause();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const darkSurface = dark ? "bg-[#0a0a0a]" : "bg-white";
  const darkText = dark ? "text-neutral-100" : "text-neutral-900";

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center overflow-y-auto p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Paylaşım gönderisi: ${title}`}
    >
      <div
        className="fixed inset-0 bg-black/60"
        onClick={handleClose}
        aria-hidden="true"
      />
      <div
        className={`relative my-6 w-full max-w-4xl overflow-hidden rounded-2xl shadow-2xl ${darkSurface}`}
      >
        {/* Başlık: avatar + @username (mobilde medyanın üstünde) */}
        <div
          className={`flex items-center gap-2.5 border-b ${dark ? "border-neutral-800" : "border-slate-100"} px-4 py-3`}
        >
          {brand.profileImageUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={brand.profileImageUrl}
              alt={brand.name}
              className="size-8 rounded-full object-cover outline-1 -outline-offset-1 outline-black/10"
            />
          ) : (
            <span
              className={`grid size-8 place-items-center rounded-full text-sm font-semibold ${dark ? "bg-neutral-800 text-neutral-200" : "bg-neutral-200 text-neutral-600"}`}
            >
              {brand.username.charAt(0).toUpperCase()}
            </span>
          )}
          <span className={`truncate text-sm font-semibold ${darkText}`}>
            {brand.username}
          </span>
          <span className="flex-1" />
          <button
            ref={closeRef}
            type="button"
            onClick={handleClose}
            aria-label="Kapat"
            className={`grid size-9 shrink-0 place-items-center rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600 ${dark ? "text-neutral-400 hover:bg-neutral-800" : "text-neutral-400 hover:bg-neutral-100"}`}
          >
            <XMarkIcon className="size-5" aria-hidden="true" />
          </button>
        </div>

        <div className="grid lg:grid-cols-2">
          {/* Medya: Reel video oynatıcı veya gönderi görseli (§11/§19) */}
          {isReel && post.videoUrl ? (
            <div className="relative aspect-square w-full bg-black">
              {/* Autoplay YOK — controls + playsInline; kullanıcı başlatır. */}
              <video
                key={post.videoUrl}
                ref={videoRef}
                src={post.videoUrl}
                controls
                playsInline
                preload="metadata"
                className="absolute inset-0 size-full object-contain"
                aria-label={`Reel videosu: ${title}`}
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

          {/* Yan panel: Instagram benzeri ikonlar + caption */}
          <div
            className={`flex flex-col gap-3 p-4 ${dark ? "text-neutral-100" : "text-neutral-900"}`}
          >
            <div className="flex items-center gap-3">
              <HeartIcon className="size-6" aria-hidden="true" />
              <ChatBubbleOvalLeftIcon className="size-6" aria-hidden="true" />
              <PaperAirplaneIcon className="size-6" aria-hidden="true" />
              <span className="flex-1" />
              <BookmarkIcon className="size-6" aria-hidden="true" />
            </div>
            <p className="text-sm leading-relaxed">
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
            {/* §19: carousel ileride multi-image genişletilebilir;
                bu fazda tek görsel + caption ile açılır. */}
            {post.postType === "carousel" ? (
              <span
                className={`inline-flex w-fit items-center gap-1.5 rounded-full px-2 py-1 text-xs font-medium ${dark ? "bg-neutral-800 text-neutral-300" : "bg-neutral-100 text-neutral-600"}`}
              >
                <RectangleStackIcon className="size-3.5" aria-hidden="true" />
                Carousel
              </span>
            ) : null}
            {post.postType === "reel" && !isReel ? (
              <span
                className={`inline-flex w-fit items-center gap-1.5 rounded-full px-2 py-1 text-xs font-medium ${dark ? "bg-neutral-800 text-neutral-300" : "bg-neutral-100 text-neutral-600"}`}
              >
                <PlayIcon className="size-3.5" aria-hidden="true" />
                Reel
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
