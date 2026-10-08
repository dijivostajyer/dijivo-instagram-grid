"use client";

import {
  useCallback,
  useEffect,
  useState,
} from "react";

import { createApiCalendarStore } from "@/lib/api-calendar-store";
import {
  LocalCalendarStore,
  type CalendarItemInput,
  type CalendarPatch,
  type CalendarStoreLike,
} from "@/lib/calendar-store";
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
  const { brandId, projectId } = options;
  const [store, setStore] = useState<CalendarStoreLike | null>(null);
  const [usingSupabase, setUsingSupabase] = useState(false);
  const [items, setItems] = useState<CalendarItem[]>([]);
  const [brandItems, setBrandItems] = useState<CalendarItem[]>([]);
  const [loadState, setLoadState] = useState<CalendarLoadState>("idle");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

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
        const [projectItems, allBrandItems] =
          await Promise.all([
            activeStore.list(brandId, projectId),
            activeStore.listAll(brandId),
          ]);
        setItems(projectItems);
        setBrandItems(allBrandItems);
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
      if (store) await load(store);
    }, [store, load]),
  };
}
