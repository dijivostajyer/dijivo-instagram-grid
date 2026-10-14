"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { BellIcon } from "@heroicons/react/24/outline";

import { formatFeedbackDateTime } from "@/lib/feedback-center";
import { feedbackNotificationText, formatBadgeCount, type FeedbackNotificationItem } from "@/lib/feedback-notifications";
import { monthLabel } from "@/lib/project-ops";
import type { GridProject } from "@/lib/storage";
import type { Brand } from "@/lib/types";

/**
 * Üst bardaki bildirim zili: okunmamış geri bildirim rozeti ve son
 * bildirimlerin açılır paneli (mobilde ekran genişliğinde panel).
 */
export default function NotificationBell({
  count,
  items,
  loaded,
  error,
  brands,
  projects,
  onOpenItem,
  onViewAll,
  onMarkAllRead,
}: {
  count: number;
  items: FeedbackNotificationItem[];
  loaded: boolean;
  error: string | null;
  brands: Brand[];
  projects: GridProject[];
  onOpenItem: (id: string) => void;
  onViewAll: () => void;
  onMarkAllRead: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const badge = formatBadgeCount(count);

  const brandById = useMemo(() => new Map(brands.map((brand) => [brand.id, brand])), [brands]);
  const projectById = useMemo(() => new Map(projects.map((project) => [project.id, project])), [projects]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function markAll() {
    setBusy(true);
    setActionError(null);
    try {
      await onMarkAllRead();
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "Bildirimler okundu yapılamadı.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label={badge ? `Bildirimler, ${count} okunmamış` : "Bildirimler"}
        aria-expanded={open}
        aria-controls={panelId}
        aria-haspopup="dialog"
        className="relative grid size-9 shrink-0 place-items-center rounded-lg text-neutral-600 hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
      >
        <BellIcon className="size-5" aria-hidden="true" />
        {badge ? (
          <span data-testid="notification-badge" className="absolute -right-0.5 -top-0.5 grid h-[1.125rem] min-w-[1.125rem] place-items-center rounded-full bg-red-600 px-1 text-[10px] font-semibold leading-none text-white ring-2 ring-white">
            {badge}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          id={panelId}
          role="dialog"
          aria-label="Bildirimler"
          className="fixed inset-x-3 top-[4.25rem] z-50 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:w-96"
        >
          <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
            <h2 className="text-sm font-semibold text-neutral-900">Bildirimler</h2>
            <button
              type="button"
              onClick={() => void markAll()}
              disabled={busy || count === 0}
              className="rounded-md px-2 py-1 text-xs font-medium text-sky-700 hover:bg-sky-50 disabled:cursor-not-allowed disabled:text-neutral-400 disabled:hover:bg-transparent"
            >
              {busy ? "Kaydediliyor…" : "Tümünü Okundu Yap"}
            </button>
          </div>

          <div className="max-h-[min(65vh,28rem)] overflow-y-auto">
            {!loaded && !error ? <p className="px-4 py-6 text-center text-sm text-neutral-500">Yükleniyor…</p> : null}
            {error && !items.length ? <p role="alert" className="px-4 py-6 text-center text-sm text-red-700">Bildirimler yüklenemedi.</p> : null}
            {loaded && !items.length && !error ? <p className="px-4 py-8 text-center text-sm text-neutral-500">Henüz bildirim yok.</p> : null}
            <ul>
              {items.map((item) => {
                const brand = item.brandId ? brandById.get(item.brandId) : undefined;
                const project = item.projectId ? projectById.get(item.projectId) : undefined;
                const unread = !item.readAt;
                const text = feedbackNotificationText({
                  brandName: brand?.name ?? "Bir marka",
                  monthLabel: project ? monthLabel(project.month, project.year) : null,
                  targetType: item.targetType,
                  action: item.action,
                });
                return (
                  <li key={item.id} className="border-b border-slate-100 last:border-b-0">
                    <button
                      type="button"
                      data-testid="notification-item"
                      onClick={() => {
                        setOpen(false);
                        onOpenItem(item.id);
                      }}
                      className={`flex w-full min-w-0 gap-3 px-4 py-3 text-left hover:bg-slate-50 focus-visible:bg-slate-50 focus-visible:outline-none ${unread ? "bg-sky-50/40" : ""}`}
                    >
                      <span className={`mt-1.5 size-2 shrink-0 rounded-full ${unread ? "bg-sky-600" : "bg-transparent"}`} aria-hidden="true" />
                      <span className="min-w-0 flex-1">
                        <span className={`block break-words text-sm ${unread ? "font-semibold text-neutral-900" : "text-neutral-700"}`}>
                          {text}
                          {unread ? <span className="sr-only"> (okunmamış)</span> : null}
                        </span>
                        {item.messagePreview ? (
                          <span className="mt-0.5 line-clamp-2 block break-words text-sm text-neutral-600">“{item.messagePreview}”</span>
                        ) : null}
                        <span className="mt-1 block truncate text-xs text-neutral-500">
                          {item.clientName} · <time dateTime={item.createdAt}>{formatFeedbackDateTime(item.createdAt)}</time>
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>

          {actionError ? <p role="alert" className="border-t border-slate-100 px-4 py-2 text-xs text-red-700">{actionError}</p> : null}
          <div className="border-t border-slate-100 p-2">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onViewAll();
              }}
              className="h-10 w-full rounded-lg text-sm font-medium text-sky-700 hover:bg-sky-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
            >
              Tüm Geri Dönüşleri Gör
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
