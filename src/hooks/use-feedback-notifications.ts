"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { FeedbackCenterSource } from "@/lib/feedback-center-client";
import {
  NOTIFICATION_MAX_BACKOFF_MS,
  NOTIFICATION_POLL_MS,
  markItemsRead,
  type FeedbackNotificationItem,
} from "@/lib/feedback-notifications";

/** Görünür olunca, son yoklama bundan eskiyse hemen yenilenir. */
const STALE_ON_VISIBLE_MS = 15_000;

export interface FeedbackNotificationsState {
  count: number;
  items: FeedbackNotificationItem[];
  loaded: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  /** Başka bir yerde (ör. Geri Dönüşler detayı) yapılan okundu işaretini yansıtır. */
  applyRead: (result: { ids: string[]; unreadCount: number }) => void;
  markAllRead: () => Promise<void>;
}

/**
 * Okunmamış geri bildirim sayısı ve son bildirimler için hafif yoklama.
 *
 * - Sayfa görünürken `intervalMs` (varsayılan 60 sn) aralıkla yoklar.
 * - Sekme gizliyken yoklamaz; görünür olunca veri eskiyse hemen yeniler.
 * - Hata olursa aralık katlanarak uzar (en fazla 5 dk); aynı anda tek istek.
 * - Bildirimler share_feedback.read_at'ten türetilir; okunmuş kayıt tekrar
 *   "yeni" olarak gelmez.
 */
export function useFeedbackNotifications(
  source: Pick<FeedbackCenterSource, "notifications" | "markAllRead">,
  options: { enabled?: boolean; intervalMs?: number } = {},
): FeedbackNotificationsState {
  const { enabled = true, intervalMs = NOTIFICATION_POLL_MS } = options;
  const [count, setCount] = useState(0);
  const [items, setItems] = useState<FeedbackNotificationItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const lastFetchAt = useRef(0);
  const failures = useRef(0);
  // Kaynak kimliği değişse de yoklama yeniden kurulmaz (gereksiz istek olmaz).
  const sourceRef = useRef(source);
  useEffect(() => {
    sourceRef.current = source;
  }, [source]);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const summary = await sourceRef.current.notifications();
      setCount(summary.count);
      setItems(summary.items);
      setLoaded(true);
      setError(null);
      failures.current = 0;
    } catch (caught) {
      failures.current += 1;
      setError(caught instanceof Error ? caught.message : "Bildirimler yüklenemedi.");
    } finally {
      inFlight.current = false;
      lastFetchAt.current = Date.now();
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let timer: number | undefined;
    let cancelled = false;
    const nextDelay = () => Math.min(intervalMs * 2 ** failures.current, NOTIFICATION_MAX_BACKOFF_MS);
    const schedule = () => {
      window.clearTimeout(timer);
      if (cancelled || document.visibilityState === "hidden") return;
      timer = window.setTimeout(() => {
        void refresh().then(schedule);
      }, nextDelay());
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        window.clearTimeout(timer);
        return;
      }
      if (Date.now() - lastFetchAt.current > STALE_ON_VISIBLE_MS) void refresh().then(schedule);
      else schedule();
    };
    void refresh().then(schedule);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled, intervalMs, refresh]);

  const applyRead = useCallback((result: { ids: string[]; unreadCount: number }) => {
    setCount(result.unreadCount);
    if (result.ids.length) setItems((current) => markItemsRead(current, result.ids, new Date().toISOString()));
  }, []);

  const markAllRead = useCallback(async () => {
    const result = await sourceRef.current.markAllRead();
    setCount(result.unreadCount);
    setItems((current) => markItemsRead(current, "all", new Date().toISOString()));
  }, []);

  return { count, items, loaded, error, refresh, applyRead, markAllRead };
}
