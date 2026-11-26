"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { createApiCalendarStore } from "@/lib/api-calendar-store";
import {
  LocalCalendarStore,
  type CalendarItemInput,
  type CalendarPatch,
  type CalendarStoreLike,
} from "@/lib/calendar-store";
import { withBasePath } from "@/lib/base-path";
import type { CalendarItem } from "@/lib/calendar-types";

export type CalendarLoadState = "idle" | "loading" | "ready" | "error";
export interface UseCalendarStoreResult {
  /** Depo çözümlenene kadar `false` (config probe). */
  storeReady: boolean;
  usingSupabase: boolean;
  /** Aktif aylık planın kayıtları (§24 izolasyonu). */
  items: CalendarItem[];
  /** Aktif markanın TÜM kayıtları (dashboard). */
  brandItems: CalendarItem[];
  loadState: CalendarLoadState;
  /** Optimistic kayıt sırasında `true` (§36 Kaydediliyor). */
  saving: boolean;
  saveError: string | null;
  createItem: (input: CalendarItemInput) => Promise<CalendarItem | null>;
  updateItem: (
    id: string,
    patch: CalendarPatch,
  ) => Promise<CalendarItem | null>;
  removeItem: (id: string) => Promise<boolean>;
  refresh: () => Promise<void>;
}

interface UseCalendarStoreOptions {
  brandId: string;
  projectId: string;
  /**
   * Buluta kuyrukta/yolda yazım var mı? Takvim API'si marka/planın bulutta kayıtlı olmasını ister;
   * yalnızca eşitleme sürerken alınan 404 geçici sayılır. Eşitleme bitmişken alınan 404 (başka kullanıcının
   * veya olmayan marka) ASLA boş liste/başarı sayılmaz.
   */
  isSyncPending?: () => boolean;
  /** Bekleyen bulut yazımı kalmadığında artan sayaç (yeniden yükleme tetikleyicisi). */
  syncSettledTick?: number;
}

/** Eşitleme kaynaklı geçici 404 için en fazla bu kadar otomatik yeniden yükleme. */
const MAX_SYNC_RETRIES = 3;

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { status?: unknown }).status === 404;
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
 */
export function useCalendarStore(
  options: UseCalendarStoreOptions,
): UseCalendarStoreResult {
  const { brandId, projectId, isSyncPending, syncSettledTick = 0 } = options;
  const [store, setStore] = useState<CalendarStoreLike | null>(null);
  const [usingSupabase, setUsingSupabase] = useState(false);
  const [items, setItems] = useState<CalendarItem[]>([]);
  const [brandItems, setBrandItems] = useState<CalendarItem[]>([]);
  const [loadState, setLoadState] = useState<CalendarLoadState>("idle");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Yükleme yarışlarını (hızlı marka değişimi) ve eşitleme-yeniden deneme durumunu izler.
  const loadSeqRef = useRef(0);
  const awaitingSyncRef = useRef(false);
  const syncRetriesRef = useRef(0);
  const isSyncPendingRef = useRef(isSyncPending);
  isSyncPendingRef.current = isSyncPending;
  const syncTickRef = useRef(syncSettledTick);
  syncTickRef.current = syncSettledTick;

  // §22/§28: depo seçimi — Supabase varsa API katmanı,
  // yoksa yerel depo. Secret asla istemciye gitmez.
  useEffect(() => {
    let cancelled = false;
    let localStore: CalendarStoreLike | null = null;
    void (async () => {
      try {
        const response = await fetch(withBasePath("/api/calendar/config"), {
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
      const sequence = ++loadSeqRef.current;
      if (!brandId || !projectId) {
        setItems([]);
        setBrandItems([]);
        setLoadState("idle");
        return;
      }
      const tickAtStart = syncTickRef.current;
      setLoadState("loading");
      try {
        const [projectItems, allBrandItems] =
          await Promise.all([
            activeStore.list(brandId, projectId),
            activeStore.listAll(brandId),
          ]);
        // Marka/plan bu arada değiştiyse eski yanıt yeni durumun üzerine yazılmaz.
        if (sequence !== loadSeqRef.current) return;
        awaitingSyncRef.current = false;
        syncRetriesRef.current = 0;
        setItems(projectItems);
        setBrandItems(allBrandItems);
        setLoadState("ready");
      } catch (error) {
        if (sequence !== loadSeqRef.current) return;
        // 404 yalnızca eşitleme sürüyorsa (veya istek sırasında bitmişse) geçici kabul edilir ve sınırlı
        // sayıda yeniden denenir. Aksi halde (eşitleme bitmiş) gerçek hata: asla boş "başarı" gösterilmez.
        if (isNotFound(error) && syncRetriesRef.current < MAX_SYNC_RETRIES) {
          const pending = isSyncPendingRef.current?.() === true;
          const settledDuringRequest = syncTickRef.current !== tickAtStart;
          if (pending || settledDuringRequest) {
            syncRetriesRef.current += 1;
            if (pending) {
              awaitingSyncRef.current = true; // eşitleme bitince yeniden yüklenir
              return; // yükleniyor durumu korunur
            }
            void load(activeStore);
            return;
          }
        }
        awaitingSyncRef.current = false;
        console.error("[calendar] Kayıtlar yüklenemedi:", error);
        setLoadState("error");
      }
    },
    [brandId, projectId],
  );

  // Marka/proje değişince yeniden yükle (§23/§24).
  useEffect(() => {
    syncRetriesRef.current = 0;
    awaitingSyncRef.current = false;
    if (!store || !brandId || !projectId) {
      loadSeqRef.current += 1; // uçuştaki eski yanıtı geçersiz kıl
      return;
    }
    void load(store);
  }, [store, brandId, projectId, load]);

  // Eşitleme bitince, geçici 404 yüzünden bekleyen yükleme bir kez yeniden denenir.
  useEffect(() => {
    if (!store || !awaitingSyncRef.current) return;
    if (isSyncPendingRef.current?.() === true) return;
    awaitingSyncRef.current = false;
    void load(store);
  }, [syncSettledTick, store, load]);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store, brandId],
  );

  return {
    storeReady: store !== null,
    usingSupabase,
    items,
    brandItems,
    loadState,
    saving,
    saveError,
    createItem,
    updateItem,
    removeItem,
    refresh: useCallback(async () => {
      if (store && brandId && projectId) await load(store);
    }, [store, brandId, projectId, load]),
  };
}
