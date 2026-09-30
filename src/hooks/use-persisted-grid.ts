"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  SAMPLE_BRAND,
  SAMPLE_EXISTING_POSTS,
  SAMPLE_PLANNED_POSTS,
} from "@/data/sample-data";
import {
  clearStoredImages,
  deleteStoredImage,
  isImageRef,
  loadImageAsObjectUrl,
  persistObjectUrl,
} from "@/lib/image-store";
import {
  cleanUpRemovedImages,
  revokeTrackedObjectUrls,
} from "@/lib/image-lifecycle";
import {
  clearPersistedState,
  loadAppState,
  STORAGE_VERSION,
  toPersistableState,
  writePersistedState,
  type PersistedAppState,
  createProjectFromState,
  type GridProject,
  type StorageLike,
} from "@/lib/storage";
import type { Brand, ExistingPost, PlannedPost } from "@/lib/types";

/** Demo/varsayılan durum (ilk açılış ve sıfırlama sonrası). */
export function getDefaultAppState(): PersistedAppState {
  const base = {
    version: STORAGE_VERSION,
    brand: { ...SAMPLE_BRAND },
    existingPosts: SAMPLE_EXISTING_POSTS.map((post) => ({ ...post })),
    plannedPosts: SAMPLE_PLANNED_POSTS.map((post) => ({ ...post })),
  };
  const project = createProjectFromState(base);
  return { ...base, projects: [project], activeProjectId: project.id };
}

function getBrowserStorage(): StorageLike | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Kayıtlı metaveriyi tarar; `idb:` görsel referanslarını object URL'e çözer ve
 * çözdüğü eşlemeyi `refByObjectUrl` haritasına yazar (geri yazarken gerekir).
 * Blob'u bulunamayan görsel/düşer: uygulama bozuk referansla çalışmaz.
 */
async function hydrateState(
  state: PersistedAppState,
  refByObjectUrl: Map<string, string>,
  trackedObjectUrls: Set<string>,
): Promise<PersistedAppState> {
  const resolve = async (value: string | undefined): Promise<string | undefined> => {
    if (value === undefined || !isImageRef(value)) return value;
    const objectUrl = await loadImageAsObjectUrl(value);
    if (objectUrl === null) return undefined;
    refByObjectUrl.set(objectUrl, value);
    trackedObjectUrls.add(objectUrl);
    return objectUrl;
  };

  const profileImageUrl = await resolve(state.brand.profileImageUrl);

  const existingPosts: ExistingPost[] = [];
  for (const post of state.existingPosts) {
    const imageUrl = await resolve(post.imageUrl);
    if (imageUrl === undefined) continue;
    existingPosts.push({ ...post, imageUrl });
  }

  const plannedPosts: PlannedPost[] = [];
  for (const post of state.plannedPosts) {
    const imageUrl = await resolve(post.imageUrl);
    if (imageUrl === undefined) continue;
    plannedPosts.push({ ...post, imageUrl });
  }

  const hydrated = {
    version: STORAGE_VERSION,
    brand: { ...state.brand, profileImageUrl },
    existingPosts,
    plannedPosts,
    projects: state.projects,
    activeProjectId: state.activeProjectId,
  };
  return syncActiveProject(hydrated);
}

function syncActiveProject(state: PersistedAppState): PersistedAppState {
  if (!state.projects?.length || !state.activeProjectId) return state;
  return {
    ...state,
    projects: state.projects.map((project) => project.id === state.activeProjectId ? { ...project, brand: state.brand, existingPosts: state.existingPosts, plannedPosts: state.plannedPosts, updatedAt: new Date().toISOString() } : project),
  };
}

export interface PersistedGrid {
  brand: Brand;
  existingPosts: ExistingPost[];
  plannedPosts: PlannedPost[];
  /** Açılışta kayıtlı veri yüklenene kadar `false`. */
  ready: boolean;
  setBrand: (next: Brand) => void;
  setExistingPosts: (next: ExistingPost[] | ((prev: ExistingPost[]) => ExistingPost[])) => void;
  setPlannedPosts: (next: PlannedPost[] | ((prev: PlannedPost[]) => PlannedPost[])) => void;
  /** Object URL'i IndexedDB'ye kalıcılaştırır (yükleme akışlarında çağrılır). */
  persistUpload: (objectUrl: string) => Promise<void>;
  /** Kalıcı veriyi siler ve demo varsayılanlarına döner. */
  resetToDefaults: () => Promise<void>;
  projects: GridProject[];
  activeProjectId: string;
  selectProject: (id: string) => void;
  createProject: (name: string, month: number, year: number, copyPrevious: boolean) => void;
}

/**
 * Kalıcı grid durumu (MVP aşama 4).
 *
 * - Metaveri → localStorage (sürüm damgalı, doğrulanmış JSON).
 * - Yüklenen görseller → IndexedDB Blob'ları; state içinde object URL olarak
 *   görünür, yazılırken `idb:` referansına çevrilir (`toPersistableState`).
 * - Kalıcılık mantığı GridManager'dan ayrıdır; bileşen yalnızca state verir.
 */
export function usePersistedGrid(): PersistedGrid {
  const [state, setState] = useState<PersistedAppState>(getDefaultAppState);
  const [ready, setReady] = useState(false);
  const [uploadTick, setUploadTick] = useState(0);

  const refByObjectUrl = useRef<Map<string, string>>(new Map());
  const trackedObjectUrls = useRef<Set<string>>(new Set());
  const stateRef = useRef<PersistedAppState>(state);
  const skipPersistRef = useRef(false);

  stateRef.current = state;

  // Açılış: kayıtlı metaveri + görsel Blob'ları yüklenir.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const stored = loadAppState(getBrowserStorage(), getDefaultAppState());
      const hydrated = await hydrateState(
        stored,
        refByObjectUrl.current,
        trackedObjectUrls.current,
      );
      if (cancelled) return;
      stateRef.current = hydrated;
      setState(hydrated);
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Kalıcı Blob'lar saklanmaya devam eder; component kapanırken yalnızca bu
  // oturuma ait object URL'ler serbest bırakılır.
  useEffect(() => {
    return () => {
      revokeTrackedObjectUrls({
        refByObjectUrl: refByObjectUrl.current,
        trackedObjectUrls: trackedObjectUrls.current,
      });
    };
  }, []);

  // Değişiklikleri ve tamamlanan yüklemeleri yaz.
  // `blob:` URL'ler yazılmaz (toPersistableState filtresi).
  useEffect(() => {
    if (!ready) return;
    if (skipPersistRef.current) {
      skipPersistRef.current = false;
      return;
    }
    writePersistedState(
      getBrowserStorage(),
      toPersistableState(stateRef.current, refByObjectUrl.current),
    );
  }, [state, ready, uploadTick]);

  const persistUpload = useCallback(async (objectUrl: string) => {
    if (!objectUrl.startsWith("blob:")) return;
    trackedObjectUrls.current.add(objectUrl);
    try {
      const ref = await persistObjectUrl(objectUrl);
      // Görsel kalıcılaştırılırken state'ten çıktıysa yeni Blob'u da bırak.
      if (!trackedObjectUrls.current.has(objectUrl)) {
        await deleteStoredImage(ref);
        return;
      }
      refByObjectUrl.current.set(objectUrl, ref);
    } catch (error) {
      // IndexedDB yoksa/kötüyse görsel yalnızca bu oturumda kalır;
      // kalıcı metaveriye `blob:` asla yazılmaz.
      console.warn("[persistence] Görsel kalıcılaştırılamadı:", error);
    } finally {
      // Harita güncellendikten sonra persist efekti yeniden çalışsın.
      setUploadTick((tick) => tick + 1);
    }
  }, []);

  const setBrand = useCallback(
    (next: Brand) => {
      const previous = stateRef.current.brand.profileImageUrl;
      if (
        next.profileImageUrl &&
        next.profileImageUrl !== previous &&
        next.profileImageUrl.startsWith("blob:") &&
        !refByObjectUrl.current.has(next.profileImageUrl)
      ) {
        void persistUpload(next.profileImageUrl);
      }
      const previousState = stateRef.current;
      const nextState = syncActiveProject({ ...previousState, brand: next });
      stateRef.current = nextState;
      void cleanUpRemovedImages({
        previousState,
        nextState,
        refByObjectUrl: refByObjectUrl.current,
        trackedObjectUrls: trackedObjectUrls.current,
      });
      setState(nextState);
    },
    [persistUpload],
  );

  const setExistingPosts = useCallback(
    (next: ExistingPost[] | ((prev: ExistingPost[]) => ExistingPost[])) => {
      const previousState = stateRef.current;
      const nextState = syncActiveProject({
        ...previousState,
        existingPosts:
          typeof next === "function" ? next(previousState.existingPosts) : next,
      });
      stateRef.current = nextState;
      void cleanUpRemovedImages({
        previousState,
        nextState,
        refByObjectUrl: refByObjectUrl.current,
        trackedObjectUrls: trackedObjectUrls.current,
      });
      setState(nextState);
    },
    [],
  );

  const setPlannedPosts = useCallback(
    (next: PlannedPost[] | ((prev: PlannedPost[]) => PlannedPost[])) => {
      const previousState = stateRef.current;
      const nextState = syncActiveProject({
        ...previousState,
        plannedPosts:
          typeof next === "function" ? next(previousState.plannedPosts) : next,
      });
      stateRef.current = nextState;
      void cleanUpRemovedImages({
        previousState,
        nextState,
        refByObjectUrl: refByObjectUrl.current,
        trackedObjectUrls: trackedObjectUrls.current,
      });
      setState(nextState);
    },
    [],
  );

  const resetToDefaults = useCallback(async () => {
    clearPersistedState(getBrowserStorage());
    await clearStoredImages();
    revokeTrackedObjectUrls({
      refByObjectUrl: refByObjectUrl.current,
      trackedObjectUrls: trackedObjectUrls.current,
    });
    // Sıfırlama sonrası persist efekti varsayılanları geri yazmasın:
    // depo, ilk açılışta olduğu gibi temiz kalmalı.
    skipPersistRef.current = true;
    const defaults = getDefaultAppState();
    stateRef.current = defaults;
    setState(defaults);
  }, []);

  const selectProject = useCallback((id: string) => {
    const current = stateRef.current;
    const project = current.projects?.find((item) => item.id === id);
    if (!project) return;
    const next = { ...current, activeProjectId: id, brand: project.brand, existingPosts: project.existingPosts, plannedPosts: project.plannedPosts };
    stateRef.current = next;
    setState(next);
  }, []);

  const createProject = useCallback((name: string, month: number, year: number, copyPrevious: boolean) => {
    const current = syncActiveProject(stateRef.current);
    const source = copyPrevious ? { brand: current.brand, existingPosts: current.existingPosts, plannedPosts: current.plannedPosts } : { brand: { ...current.brand, profileImageUrl: undefined }, existingPosts: [], plannedPosts: [] };
    const timestamp = new Date().toISOString();
    const project: GridProject = {
      id: `project-${timestamp}-${Math.random().toString(36).slice(2, 8)}`,
      name: name.trim() || `${month}/${year}`,
      month,
      year,
      createdAt: timestamp,
      updatedAt: timestamp,
      brand: { ...source.brand, highlights: source.brand.highlights?.map((highlight) => ({ ...highlight })) },
      existingPosts: source.existingPosts.map((post) => ({ ...post, id: `existing-${timestamp}-${post.id}` })),
      plannedPosts: source.plannedPosts.map((post) => ({ ...post, id: `planned-${timestamp}-${post.id}` })),
    };
    const next = { ...current, activeProjectId: project.id, brand: project.brand, existingPosts: project.existingPosts, plannedPosts: project.plannedPosts, projects: [...(current.projects ?? []), project] };
    stateRef.current = next;
    setState(next);
  }, []);

  return {
    brand: state.brand,
    existingPosts: state.existingPosts,
    plannedPosts: state.plannedPosts,
    ready,
    setBrand,
    setExistingPosts,
    setPlannedPosts,
    persistUpload,
    resetToDefaults,
    projects: state.projects ?? [],
    activeProjectId: state.activeProjectId ?? "",
    selectProject,
    createProject,
  };
}
