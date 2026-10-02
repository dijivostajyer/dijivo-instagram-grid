"use client";

import {
  BellIcon,
  CheckIcon,
  ChevronDownIcon,
} from "@heroicons/react/20/solid";
import { useEffect, useRef, useState } from "react";

import {
  formatRelativeDay,
  isToday,
  startOfDay,
} from "@/lib/calendar-utils";
import type { ReminderDelivery } from "@/lib/calendar-types";

/** Tarayıcı bildirimi izni durumu (§29). */
type BrowserPermission = NotificationPermission | "unsupported";

/**
 * Bildirim merkezi (§26/§27/§29/§30).
 *
 * - Topbar'da 🔔 campana + okunmamış sayacı.
 * - Popover: teslim edilen hatırlatmalar,
 *   plan zamanına göre Bugün/Yarın gruplu.
 * - Tıklanan bildirim okundu işaretlenir.
 * - "Tümünü okundu işaretle" toplu işlem.
 * - Tarayıcı bildirimi izni (izin verilirse
 *   hatırlatmalar OS bildirimi olarak da gelir).
 */
export default function NotificationCenter({
  deliveries,
  unreadCount,
  browserPermission,
  onMarkRead,
  onMarkAllRead,
  onEnableBrowserNotifications,
}: {
  deliveries: ReminderDelivery[];
  unreadCount: number;
  browserPermission: BrowserPermission;
  onMarkRead: (deliveryId: string) => void;
  onMarkAllRead: () => void;
  onEnableBrowserNotifications: () => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Dışarı tıklayınca kapat (§42: Escape popover içinde kapanır).
  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  // Popover açıkken focus popover'e düşer (a11y).
  useEffect(() => {
    if (!open) return;
    containerRef.current
      ?.querySelector<HTMLElement>("[data-notification-first]")
      ?.focus();
  }, [open, deliveries]);

  const today = startOfDay(new Date());
  const todays = deliveries.filter((delivery) =>
    isToday(new Date(delivery.remindAt), today),
  );
  const older = deliveries.filter(
    (delivery) => !isToday(new Date(delivery.remindAt), today),
  );

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label={`Bildirimler${unreadCount > 0 ? `, ${unreadCount} okunmadı` : ""}`}
        aria-expanded={open}
        aria-haspopup="true"
        className="relative grid size-9 shrink-0 place-items-center rounded-lg text-neutral-600 hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
      >
        <BellIcon className="size-5" aria-hidden="true" />
        {unreadCount > 0 ? (
          <span
            className="absolute -right-1 -top-1 grid min-w-4 place-items-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white ring-2 ring-white"
            aria-hidden="true"
          >
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          className="animate-popover-in absolute right-0 z-50 mt-2 w-[22rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl"
          role="region"
          aria-label="Bildirim merkezi"
        >
          <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold text-neutral-900">
                Bildirimler
              </h2>
              <p className="text-xs text-neutral-500">
                {unreadCount > 0 ? `${unreadCount} okunmadı` : "Tümü okundu"}
              </p>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => void onMarkAllRead()}
                disabled={unreadCount === 0}
                className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium text-sky-700 hover:bg-sky-50 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-600"
              >
                <CheckIcon className="size-3.5" aria-hidden="true" />
                Tümünü okundu işaretle
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Bildirimleri kapat"
                className="grid size-7 place-items-center rounded-md text-neutral-400 hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-600"
              >
                <ChevronDownIcon className="size-4" aria-hidden="true" />
              </button>
            </div>
          </div>

          <div className="max-h-80 overflow-y-auto">
            {deliveries.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-neutral-400">
                Henüz bildirim yok.
                <br />
                Hatırlatmalı planlama ekleyin.
              </p>
            ) : (
              <>
                {todays.length > 0 ? (
                  <NotificationGroup
                    label="Bugün"
                    deliveries={todays}
                    onMarkRead={onMarkRead}
                  />
                ) : null}
                {older.length > 0 ? (
                  <NotificationGroup
                    label="Daha önce"
                    deliveries={older}
                    onMarkRead={onMarkRead}
                  />
                ) : null}
              </>
            )}
          </div>

          {/* Tarayıcı bildirimi (§29) */}
          {browserPermission !== "granted" ? (
            <div className="border-t border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-xs text-neutral-500">
                Uygulama açıkken tarayıcı bildirimi de gelsin.
              </p>
              <button
                type="button"
                onClick={() => void onEnableBrowserNotifications()}
                disabled={browserPermission === "denied" || browserPermission === "unsupported"}
                className="mt-2 h-8 w-full rounded-lg bg-sky-700 text-xs font-medium text-white hover:bg-sky-800 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
              >
                {browserPermission === "denied"
                  ? "Tarayıcı bildirimleri engellendi"
                  : browserPermission === "unsupported"
                    ? "Tarayıcı bildirimi desteklenmiyor"
                    : "Tarayıcı bildirimlerini etkinleştir"}
              </button>
            </div>
          ) : (
            <div className="border-t border-slate-200 bg-emerald-50/60 px-4 py-2 text-xs text-emerald-700">
              Tarayıcı bildirimleri etkin.
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function NotificationGroup({
  label,
  deliveries,
  onMarkRead,
}: {
  label: string;
  deliveries: ReminderDelivery[];
  onMarkRead: (deliveryId: string) => void;
}) {
  return (
    <section aria-label={label}>
      <h3 className="px-4 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
        {label}
      </h3>
      <ul>
        {deliveries.map((delivery, index) => (
          <li key={delivery.id}>
            <button
              type="button"
              data-notification-first={index === 0 && label === "Bugün"}
              onClick={() => onMarkRead(delivery.id)}
              className={`flex w-full items-start gap-2.5 px-4 py-2.5 text-left transition hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-sky-600 ${
                delivery.readAt ? "opacity-60" : ""
              }`}
              aria-label={`${delivery.readAt ? "" : "Okunmadı: "}${delivery.title} — ${formatRelativeDay(delivery.scheduledAt)}`}
            >
              <span
                className={`mt-1.5 size-2 shrink-0 rounded-full ${
                  delivery.readAt ? "bg-slate-300" : "bg-sky-600"
                }`}
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-neutral-900">
                  {delivery.title}
                </span>
                <span className="block truncate text-xs text-neutral-500">
                  {delivery.body}
                </span>
                <span className="mt-0.5 block text-[11px] font-medium text-sky-700">
                  {formatRelativeDay(delivery.scheduledAt)}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
