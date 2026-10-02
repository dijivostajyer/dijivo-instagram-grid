"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { createApiCalendarStore } from "@/lib/api-calendar-store";
import { reminderAt } from "@/lib/calendar-utils";
import {
  LocalCalendarStore,
  type CalendarItemInput,
  type CalendarPatch,
  type CalendarStoreLike,
} from "@/lib/calendar-store";
import type { CalendarItem, ReminderDelivery } from "@/lib/calendar-types";
import {
  isNotificationSupported,
  notificationPermission,
  requestNotificationPermission,
  showBrowserNotification,
} from "@/lib/browser-push";

/** Hatırlatma döngüsü aralığı (§27). */
const REMINDER_POLL_MS = 15_000;
/**
 * Geç kaldı Window: planlama zamanından önce oluşturulan
 * kayıtların eski hatırlatmaları 12 saatten eskiyse
 * teslim edilmez (spam önleyici).
 */
const REMINDER_LATE_WINDOW_MS = 12 * 60 * 60 * 1000;

export type CalendarLoadState = "idle" | "loading" | "ready" | "error";

export interface UseCalendarStoreResult {
  /** Depo çözümlenene kadar `false` (config probe). */
  storeReady: boolean;
  usingSupabase: boolean;
  /** Aktif aylık planın kayıtları (§24 izolasyonu). */
  items: CalendarItem[];
  /** Aktif markanın TÜM kayıtları (dashboard + hatırlatma motoru). */
  brandItems: CalendarItem[];
  deliveries: ReminderDelivery[];
  unreadCount: number;
  loadState: CalendarLoadState;
  /** Optimistic kayıt sırasında `true` (§36 Kaydediliyor). */
  saving: boolean;
  saveError: string | null;
  browserPermission: NotificationPermission | "unsupported";
  enableBrowserNotifications: () => Promise<void>;
  createItem: (input: CalendarItemInput) => Promise<CalendarItem | null>;
  updateItem: (
    id: string,
    patch: CalendarPatch,
  ) => Promise<CalendarItem | null>;
  removeItem: (id: string) => Promise<boolean>;
  markRead: (deliveryId: string) => Promise<void>;
  markAllRead: () => Promise<void>;
  refresh: () => Promise<void>;
}

interface UseCalendarStoreOptions {
  brandId: string;
  projectId: string;
  /** Hatırlatma tesliminde toast gibi UI aksiyonu (§26/§27). */
  onReminder?: (delivery: ReminderDelivery) => void;
}

interface CalendarConfigResponse {
  supabase?: boolean;
}

/**
 * Takvim veri katmanı (§22/§28/§36).
 *
 * - `/api/calendar/config` bir kez probe edilir; Supabase
 *   yapılandırmışsa API katmanı, yoksa yerel depo kullanılır.
 *   Secret key istemci bundle'ına asla girmez.
 * - Kayıt işlemleri optimistic: UI anında güncellenir, hata
 *   durumunda rollback + "Kaydedilemedi" (§36).
 * - Hatırlatma motoru: 15 saniyede bir due olan hatırlatmaları
 *   teslim eder; `(itemId, remindAt)` eşsizliği sayesinde
 *   aynı hatırlatma bir kez gelir (§27).
 */
export function useCalendarStore(
  options: UseCalendarStoreOptions,
): UseCalendarStoreResult {
  const { brandId, projectId, onReminder } = options;
  const [store, setStore] = useState<CalendarStoreLike | null>(null);
  const [usingSupabase, setUsingSupabase] = useState(false);
  const [items, setItems] = useState<CalendarItem[]>([]);
  const [brandItems, setBrandItems] = useState<CalendarItem[]>([]);
  const [deliveries, setDeliveries] = useState<ReminderDelivery[]>([]);
  const [loadState, setLoadState] = useState<CalendarLoadState>("idle");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [browserPermission, setBrowserPermission] =
    useState<NotificationPermission | "unsupported">(
      notificationPermission(),
    );

  const onReminderRef = useRef(onReminder);
  onReminderRef.current = onReminder;
  const brandItemsRef = useRef<CalendarItem[]>([]);
  brandItemsRef.current = brandItems;
  const deliveriesRef = useRef<ReminderDelivery[]>([]);
  deliveriesRef.current = deliveries;
  /** Oturum içi teslim deduplikasyonu (store katmanı da korur). */
  const deliveredKeysRef = useRef<Set<string>>(new Set());

  // §22/§28: depo seçimi — Supabase varsa API katmanı,
  // yoksa yerel depo. Secret asla istemciye gitmez.
  useEffect(() => {
    let cancelled = false;
    let localStore: CalendarStoreLike | null = null;
    void (async () => {
      try {
        const response = await fetch("/api/calendar/config", {
          cache: "no-store",
        });
        if (!response.ok) throw new Error("config yok");
        const config = (await response.json()) as CalendarConfigResponse;
        if (cancelled) return;
        if (config.supabase) {
          setUsingSupabase(true);
          setStore(createApiCalendarStore("/api/calendar"));
          return;
        }
      } catch {
        // API katmanı yanıtlamıyorsa yerel depoya düş.
      }
      if (cancelled) return;
      if (!localStore) {
        localStore = new LocalCalendarStore();
      }
      setUsingSupabase(false);
      setStore(localStore);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const load = useCallback(
    async (activeStore: CalendarStoreLike) => {
      setLoadState("loading");
      try {
        const [projectItems, allBrandItems, allDeliveries] =
          await Promise.all([
            activeStore.list(brandId, projectId),
            activeStore.listAll(brandId),
            activeStore.listDeliveries(brandId),
          ]);
        setItems(projectItems);
        setBrandItems(allBrandItems);
        setDeliveries(allDeliveries);
        // Teslim edilmişleri oturum haritasına al (tekrar teslim yok).
        deliveredKeysRef.current = new Set(
          allDeliveries.map(
            (delivery) => `${delivery.itemId}|${delivery.remindAt}`,
          ),
        );
        setLoadState("ready");
      } catch (error) {
        console.error("[calendar] Kayıtlar yüklenemedi:", error);
        setLoadState("error");
      }
    },
    [brandId, projectId],
  );

  // Marka/proje değişince yeniden yükle (§23/§24).
  useEffect(() => {
    if (!store) return;
    void load(store);
  }, [store, load]);

  /**
   * §27: hatırlatma motoru. Due olan hatırlatmaları
   * once-only olarak teslim eder; in-app bildirim +
   * (izin verildiyse) tarayıcı bildirimi çıkarır.
   */
  useEffect(() => {
    if (!store) return;
    let cancelled = false;
    const deliverDue = async () => {
      if (cancelled) return;
      const now = Date.now();
      const activeDeliveries = deliveriesRef.current;
      const delivered = new Set(
        activeDeliveries.map(
          (delivery) => `${delivery.itemId}|${delivery.remindAt}`,
        ),
      );
      for (const key of deliveredKeysRef.current) delivered.add(key);
      for (const item of brandItemsRef.current) {
        if (item.brandId !== brandId) continue;
        if (item.reminderOffsetMinutes == null) continue;
        const remindAt = reminderAt(item.scheduledAt, item.reminderOffsetMinutes);
        const remindTime = remindAt.getTime();
        if (Number.isNaN(remindTime)) continue;
        if (remindTime > now) continue;
        if (remindTime < now - REMINDER_LATE_WINDOW_MS) continue;
        const key = `${item.id}|${remindAt.toISOString()}`;
        if (delivered.has(key)) continue;
        delivered.add(key);
        deliveredKeysRef.current.add(key);
        try {
          const delivery = await store.deliverReminder({
            itemId: item.id,
            brandId,
            channel: "in_app",
            remindAt: remindAt.toISOString(),
            scheduledAt: item.scheduledAt,
            title: item.title,
            body: `${item.itemType === "task" ? "Görev" : item.itemType === "note" ? "Not" : item.itemType === "story" ? "Story" : item.itemType === "reel" ? "Reel" : "Post"} hatırlatması`,
          });
          setDeliveries((previous) => [delivery, ...previous]);
          // §29: uygulama açıkken tarayıcı bildirimi (izin varsa).
          showBrowserNotification(
            `Hatırlatma: ${item.title}`,
            delivery.body,
          );
          onReminderRef.current?.(delivery);
        } catch (error) {
          // 409/duplicate: zaten teslim edilmiş — sessizce atla.
          const message =
            error instanceof Error ? error.message : String(error);
          if (!/zaten/i.test(message)) {
            console.error("[calendar] Hatırlatma teslim edilemedi:", error);
          }
        }
      }
    };
    void deliverDue();
    const timer = setInterval(() => void deliverDue(), REMINDER_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [store, brandId]);

  const enableBrowserNotifications = useCallback(async () => {
    const permission = await requestNotificationPermission();
    setBrowserPermission(permission);
  }, []);

  /** §36: optimistic create — hata durumunda rollback. */
  const createItem = useCallback(
    async (input: CalendarItemInput): Promise<CalendarItem | null> => {
      if (!store) return null;
      setSaving(true);
      setSaveError(null);
      const optimistic: CalendarItem = {
        ...input,
        id: `optimistic-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      setItems((previous) => [...previous, optimistic]);
      setBrandItems((previous) => [...previous, optimistic]);
      try {
        const created = await store.create(input);
        setItems((previous) =>
          previous.map((item) => (item.id === optimistic.id ? created : item)),
        );
        setBrandItems((previous) =>
          previous.map((item) => (item.id === optimistic.id ? created : item)),
        );
        return created;
      } catch (error) {
        setItems((previous) =>
          previous.filter((item) => item.id !== optimistic.id),
        );
        setBrandItems((previous) =>
          previous.filter((item) => item.id !== optimistic.id),
        );
        const message = error instanceof Error ? error.message : String(error);
        setSaveError(message || "Kaydedilemedi. Lütfen tekrar deneyin.");
        return null;
      } finally {
        setSaving(false);
      }
    },
    [store],
  );

  /** §36: optimistic update — hata durumunda rollback. */
  const updateItem = useCallback(
    async (
      id: string,
      patch: CalendarPatch,
    ): Promise<CalendarItem | null> => {
      if (!store) return null;
      setSaving(true);
      setSaveError(null);
      const previousItems = items;
      const previousBrandItems = brandItems;
      const applyPatch = (item: CalendarItem): CalendarItem => ({
        ...item,
        ...patch,
        updatedAt: new Date().toISOString(),
      });
      setItems((previous) =>
        previous.map((item) => (item.id === id ? applyPatch(item) : item)),
      );
      setBrandItems((previous) =>
        previous.map((item) => (item.id === id ? applyPatch(item) : item)),
      );
      try {
        const updated = await store.update(id, patch, brandId);
        setItems((previous) =>
          previous.map((item) => (item.id === id ? updated : item)),
        );
        setBrandItems((previous) =>
          previous.map((item) => (item.id === id ? updated : item)),
        );
        return updated;
      } catch (error) {
        setItems(previousItems);
        setBrandItems(previousBrandItems);
        const message = error instanceof Error ? error.message : String(error);
        setSaveError(message || "Kaydedilemedi. Lütfen tekrar deneyin.");
        return null;
      } finally {
        setSaving(false);
      }
    },
    [store, brandId, items, brandItems],
  );

  /** §36: optimistic delete — hata durumunda rollback. */
  const removeItem = useCallback(
    async (id: string): Promise<boolean> => {
      if (!store) return false;
      setSaving(true);
      setSaveError(null);
      const previousItems = items;
      const previousBrandItems = brandItems;
      setItems((previous) => previous.filter((item) => item.id !== id));
      setBrandItems((previous) =>
        previous.filter((item) => item.id !== id),
      );
      try {
        await store.remove(id, brandId);
        return true;
      } catch (error) {
        setItems(previousItems);
        setBrandItems(previousBrandItems);
        const message = error instanceof Error ? error.message : String(error);
        setSaveError(message || "Silinemedi. Lütfen tekrar deneyin.");
        return false;
      } finally {
        setSaving(false);
      }
    },
    [store, brandId, items, brandItems],
  );

  const markRead = useCallback(
    async (deliveryId: string) => {
      if (!store) return;
      // Optimistic: okundu işareti anında görünür.
      setDeliveries((previous) =>
        previous.map((delivery) =>
          delivery.id === deliveryId
            ? { ...delivery, readAt: new Date().toISOString() }
            : delivery,
        ),
      );
      try {
        await store.markRead(deliveryId, brandId);
      } catch (error) {
        console.error("[calendar] Bildirim okundu işaretlenemedi:", error);
      }
    },
    [store, brandId],
  );

  const markAllRead = useCallback(async () => {
    if (!store) return;
    const timestamp = new Date().toISOString();
    setDeliveries((previous) =>
      previous.map((delivery) => ({ ...delivery, readAt: timestamp })),
    );
    try {
      await store.markAllRead(brandId);
    } catch (error) {
      console.error("[calendar] Bildirimler okundu işaretlenemedi:", error);
    }
  }, [store, brandId]);

  const unreadCount = useMemo(
    () => deliveries.filter((delivery) => !delivery.readAt).length,
    [deliveries],
  );

  return {
    storeReady: store !== null,
    usingSupabase,
    items,
    brandItems,
    deliveries,
    unreadCount,
    loadState,
    saving,
    saveError,
    browserPermission,
    enableBrowserNotifications,
    createItem,
    updateItem,
    removeItem,
    markRead,
    markAllRead,
    refresh: useCallback(async () => {
      if (store) await load(store);
    }, [store, load]),
  };
}

/** Tarayıcı bildirim desteği (§29) — bileşenler için. */
export { isNotificationSupported };
