"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  clearStoredImages,
  deleteStoredImage,
  isImageRef,
  loadImageAsObjectUrl,
  persistObjectUrl,
} from "../lib/image-store";
import {
  clearStoredVideos,
  deleteStoredVideo,
  isVideoRef,
  loadVideoAsObjectUrl,
  persistVideoObjectUrl,
} from "../lib/video-store";
import {
  cleanUpRemovedImages,
  revokeTrackedObjectUrls,
} from "../lib/image-lifecycle";
import {
  clearPersistedState,
  loadAppState,
  STORAGE_VERSION,
  toPersistableState,
  writePersistedState,
  type PersistedAppState,
  type GridProject,
  type StorageLike,
} from "../lib/storage";
import type { Brand, ExistingPost, Highlight, PlannedPost } from "../lib/types";
import {
  copyHighlightToBrandState,
  copyPostToProjectState,
  createBrandState,
  createProjectState,
  getDefaultAppState,
  selectBrandState,
  selectProjectState,
  removeBrandState,
  syncActiveProject,
  updateBrandState,
} from "../lib/brand-ops";
import type { NewBrandInput, PostCopyOptions } from "../lib/brand-ops";
import { getSupabaseBrowserClient } from "../lib/supabase-browser";
import { pullWorkspace, pushWorkspace, reconcileWorkspaceState } from "../lib/workspace-store";
import { isWorkspaceMediaRef, resolveWorkspaceMedia } from "../lib/workspace-media-store";
import { withBasePath } from "../lib/base-path";

/**
 * §16/§2: tip tanımıları saf geçiş modülünde (brand-ops) yaşar;
 * burada yeniden dışa aktarılır böylece bileşenler hook'tan
 * ithal etmeye devam eder.
 */
export type { PostCopyOptions, NewBrandInput } from "../lib/brand-ops";
export { getDefaultAppState };

function getBrowserStorage(): StorageLike | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Kayıtlı metaveryi tarar; `idb:` görsel referanslarını object URL'e
 * çözer ve çözdüğü eşlemeyi `refByObjectUrl` haritasına yazar (geri
 * yazarken gerekir). Blob'u bulunamayan görsel düşer: uygulama bozuk
 * referansla çalışmaz.
 */
export async function hydrateState(
  state: PersistedAppState,
  refByObjectUrl: Map<string, string>,
  trackedObjectUrls: Set<string>,
): Promise<PersistedAppState> {
  // `idb:` görsel ve `idb-video:` video referanslarını tek haritada
  // çözer: aynı object URL iki farklı kalıcı katmana eşleyebilir.
  const resolve = async (value: string | undefined): Promise<string | undefined> => {
    if (value === undefined) return value;
    for (const [objectUrl, ref] of refByObjectUrl) {
      if (ref === value) return objectUrl;
    }
    if (isVideoRef(value)) {
      const objectUrl = await loadVideoAsObjectUrl(value);
      if (objectUrl === null) return undefined;
      refByObjectUrl.set(objectUrl, value);
      trackedObjectUrls.add(objectUrl);
      return objectUrl;
    }
    if (isWorkspaceMediaRef(value)) {
      try {
        const signedUrl = await resolveWorkspaceMedia(value);
        refByObjectUrl.set(signedUrl, value);
        return signedUrl;
      } catch {
        return undefined;
      }
    }
    if (!isImageRef(value)) return value;
    const objectUrl = await loadImageAsObjectUrl(value);
    if (objectUrl === null) return undefined;
    refByObjectUrl.set(objectUrl, value);
    trackedObjectUrls.add(objectUrl);
    return objectUrl;
  };

  const hydrateBrand = async (brand: Brand): Promise<Brand> => ({
    ...brand,
    profileImageUrl: await resolve(brand.profileImageUrl),
    highlights: await Promise.all((brand.highlights ?? []).map(async (highlight) => ({
      ...highlight,
      imageUrl: await resolve(highlight.imageUrl),
    }))),
  });
  const hydratedBrand = await hydrateBrand(state.brand);

  /**
   * Tek gönderinin görsel/video/kapak referanslarını çözer.
   * Görseli çözülemeyen gönderi `null` döner (listeden düşer);
   * video/kapak referansı çözülemeyen reel ise ilgili alanları
   * temizler — geçersiz `idb:`/`idb-video:` URL'leriyle çalışılmaz
   * ve eski reel kayıtları video olmadan açılabilir (§4/§5).
   */
  const hydratePost = async <T extends ExistingPost | PlannedPost>(
    post: T,
  ): Promise<T | null> => {
    const imageUrl = await resolve(post.imageUrl);
    if (imageUrl === undefined) return null;
    const videoUrl = await resolve(post.videoUrl);
    const coverImageUrl = await resolve(post.coverImageUrl);
    const hydrated = { ...post, imageUrl } as T;
    const media = hydrated as ExistingPost;
    if (videoUrl !== undefined) media.videoUrl = videoUrl;
    else if (post.videoUrl !== undefined) delete media.videoUrl;
    if (coverImageUrl !== undefined) media.coverImageUrl = coverImageUrl;
    else if (post.coverImageUrl !== undefined) delete media.coverImageUrl;
    return hydrated;
  };

  const existingPosts: ExistingPost[] = [];
  for (const post of state.existingPosts) {
    const hydrated = await hydratePost(post);
    if (hydrated !== null) existingPosts.push(hydrated);
  }

  const plannedPosts: PlannedPost[] = [];
  for (const post of state.plannedPosts) {
    const hydrated = await hydratePost(post);
    if (hydrated !== null) plannedPosts.push(hydrated);
  }

  const projects = await Promise.all((state.projects ?? []).map(async (project) => ({
    ...project,
    brand: await hydrateBrand(project.brand),
    existingPosts: (await Promise.all(project.existingPosts.map((post) => hydratePost(post)))).filter(
      (post): post is ExistingPost => post !== null,
    ),
    plannedPosts: (await Promise.all(project.plannedPosts.map((post) => hydratePost(post)))).filter(
      (post): post is PlannedPost => post !== null,
    ),
  })));
  const hydrated = {
    version: STORAGE_VERSION,
    brand: hydratedBrand,
    existingPosts,
    plannedPosts,
    projects,
    activeProjectId: state.activeProjectId,
    brands: await Promise.all((state.brands ?? []).map(hydrateBrand)),
    activeBrandId: state.activeBrandId,
  };
  return syncActiveProject(hydrated);
}

export interface PersistedGrid {
  brand: Brand;
  existingPosts: ExistingPost[];
  plannedPosts: PlannedPost[];
  /** Açılışta kayıtlı veri yüklenene kadar `false`. */
  ready: boolean;
  /** Uzak workspace yazımı başarısız olursa kullanıcıya gösterilecek hata. */
  syncError: string | null;
  /** Marka kayıt defteri (tüm markalar). */
  brands: Brand[];
  /** Aktif marka kimliği; boşsa henüz marka yoktur (onboarding). */
  activeBrandId: string;
  /** Marka oluşturur, aktif yapar ve ilk aylık projeyi açar. */
  createBrand: (input: NewBrandInput) => Brand | null;
  /** Aktif markayı değiştirir; o markanın en son projesi seçilir. */
  selectBrand: (id: string) => void;
  setBrand: (next: Brand) => void;
  /** İstenen markanın profilini günceller; aktif bağlam değişmez (§8/§11). */
  updateBrand: (id: string, next: Brand) => void;
  setExistingPosts: (next: ExistingPost[] | ((prev: ExistingPost[]) => ExistingPost[])) => void;
  setPlannedPosts: (next: PlannedPost[] | ((prev: PlannedPost[]) => PlannedPost[])) => void;
  /** Object URL'i IndexedDB'ye kalıcılaştırır (yükleme akışlarında çağrılır). */
  persistUpload: (objectUrl: string) => Promise<void>;
  /**
   * Video object URL'ini ayrı IndexedDB katmanına kalıcılaştırır;
   * metaveride `idb-video:<id>` referansı üretir (Phase 2, §9).
   */
  persistVideoUpload: (objectUrl: string) => Promise<void>;
  /** Kalıcı veriyi siler ve temiz workspace'a (onboarding) döner. */
  resetToDefaults: () => Promise<void>;
  deleteBrand: (id: string) => Promise<void>;
  /** Aktif markaya ait projeler (sıkı marka izolasyonu, §5). */
  projects: GridProject[];
  /** Tüm markaların projeleri (çapraz proje/marka kopyalama picker'ı için). */
  allProjects: GridProject[];
  /**
   * Gönderiyi başka bir aylık plana (aynı veya başka marka)
   * kopyalar; yeni kimlik verir, kaynağı değiştirmez (§16).
   */
  copyPostToProject: (postId: string, targetProjectId: string, options: PostCopyOptions) => string | null;
  /** Öne çıkanı başka bir markaya kopyalar; yeni kimlik verir (§17). */
  copyHighlightToBrand: (highlightId: string, targetBrandId: string) => string | null;
  activeProjectId: string;
  selectProject: (id: string) => void;
  createProject: (name: string, month: number, year: number, copyPrevious: boolean) => string | null;
}

/**
 * Kalıcı grid durumu (çoklu marka workspace).
 *
 * Tüm saf durum geçişleri `lib/brand-ops.ts` içinde test edilebilir
 * biçimde yaşar; bu hook yalnızca React durumunu/yan etkileri
 * (kalıcılık, görsel yaşam döngüsü) bağlar.
 *
 * - Metaveri → localStorage (sürüm damgalı, doğrulanmış JSON).
 * - Yüklenen görseller → IndexedDB Blob'ları; state içinde object URL olarak
 *   görünür, yazılırken `idb:` referansına çevrilir (`toPersistableState`).
 * - Üst düzey `brand`/`existingPosts`/`plannedPosts`, aktif projenin
 *   aynısıdır (mirror); gerçek kaynak `projects[]` içindeki projelerdir.
 * - Kalıcılık mantığı GridManager'dan ayrıdır; bileşen yalnızca state verir.
 */
export function usePersistedGrid(): PersistedGrid {
  const [state, setState] = useState<PersistedAppState>(getDefaultAppState);
  const [ready, setReady] = useState(false);
  const [uploadTick, setUploadTick] = useState(0);
  const [syncError, setSyncError] = useState<string | null>(null);

  const refByObjectUrl = useRef<Map<string, string>>(new Map());
  const trackedObjectUrls = useRef<Set<string>>(new Set());
  const stateRef = useRef<PersistedAppState>(state);
  const skipPersistRef = useRef(false);
  const workspaceUserRef = useRef<import("@supabase/supabase-js").User | null>(null);
  const syncChainRef = useRef<Promise<void>>(Promise.resolve());
  const syncSequenceRef = useRef(0);

  stateRef.current = state;

  // Açılış: kayıtlı metaveri + görsel Blob'ları yüklenir.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const localPersisted = loadAppState(getBrowserStorage(), getDefaultAppState());
      // Local IDB refs must become Blob URLs before reconciliation so their
      // media can be streamed to Storage instead of being dropped as `idb:`.
      const local = await hydrateState(
        localPersisted,
        refByObjectUrl.current,
        trackedObjectUrls.current,
      );
      const db = getSupabaseBrowserClient();
      const user = (await db?.auth.getUser())?.data.user ?? null;
      workspaceUserRef.current = user;
      let stored = local;
      if (user) {
        try {
          const remote = await pullWorkspace(user);
          const reconciled = reconcileWorkspaceState(remote, local);
          // Do not treat a non-empty workspace as fully migrated. Each entity
          // type is upserted, so missing posts/highlights heal without
          // overwriting existing remote records with local duplicates.
          if ((reconciled.brands?.length ?? 0) > 0) stored = await pushWorkspace(user, reconciled);
        } catch (error) {
          console.warn("[workspace] Uzak workspace yüklenemedi; yerel kopya kullanılacak.", error);
        }
      }
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
    const user = workspaceUserRef.current;
    if (user) {
      // Send the live state, not its localStorage representation. The latter
      // intentionally contains `idb:` refs, which cannot be uploaded to
      // Supabase Storage and previously aborted the whole post upsert.
      // Writes are serialized. Without this, an older full-state request can
      // finish after a newer one and restore stale rows following an upload.
      const snapshot = stateRef.current;
      const sequence = ++syncSequenceRef.current;
      syncChainRef.current = syncChainRef.current
        .catch(() => undefined)
        .then(async () => {
          await pushWorkspace(user, snapshot);
          if (sequence === syncSequenceRef.current) setSyncError(null);
        })
        .catch((error) => {
          const detail = error instanceof Error ? error.message : "Bilinmeyen hata";
          console.error("[workspace] Uzak sync başarısız; yerel kopya korundu.", error);
          if (sequence === syncSequenceRef.current) {
            setSyncError(`Değişiklikler buluta kaydedilemedi: ${detail}`);
          }
        });
    }
  }, [state, ready, uploadTick]);

  const commit = useCallback((next: PersistedAppState) => {
    stateRef.current = next;
    setState(next);
  }, []);

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

  // Phase 2 (§9): reel videoları görsellerden AYRı IndexedDB
  // katmanına (video-store) yazılır; yaşam döngüsü image
  // lifecycle sisteminden bağımsızdır.
  const persistVideoUpload = useCallback(async (objectUrl: string) => {
    if (!objectUrl.startsWith("blob:")) return;
    trackedObjectUrls.current.add(objectUrl);
    try {
      const ref = await persistVideoObjectUrl(objectUrl);
      if (!trackedObjectUrls.current.has(objectUrl)) {
        await deleteStoredVideo(ref);
        return;
      }
      refByObjectUrl.current.set(objectUrl, ref);
    } catch (error) {
      // Video kalıcılaştırılamazsa yalnızca oturumda kalır;
      // kalıcı metaveriye `blob:` asla yazılmaz.
      console.warn("[persistence] Video kalıcılaştırılamadı:", error);
    } finally {
      setUploadTick((tick) => tick + 1);
    }
  }, []);

  const updateBrand = useCallback(
    (id: string, next: Brand) => {
      const imageUrls = [next.profileImageUrl, ...(next.highlights ?? []).map((highlight) => highlight.imageUrl)];
      for (const url of imageUrls) {
        if (url?.startsWith("blob:") && !refByObjectUrl.current.has(url)) {
          void persistUpload(url);
        }
      }
      const previousState = stateRef.current;
      // §7/§8/§11: marka düzenlemesi kayıt defterindeki ilgili
      // marka girişini günceller; aktif bağlam yalnızca aktif
      // marka düzenlenirse etkilenir.
      const nextState = updateBrandState(previousState, id, next);
      void cleanUpRemovedImages({
        previousState,
        nextState,
        refByObjectUrl: refByObjectUrl.current,
        trackedObjectUrls: trackedObjectUrls.current,
      });
      commit(nextState);
    },
    [commit, persistUpload],
  );

  const setBrand = useCallback(
    (next: Brand) => {
      updateBrand(stateRef.current.activeBrandId ?? "", next);
    },
    [updateBrand],
  );

  const createBrand = useCallback(
    (input: NewBrandInput): Brand | null => {
      const result = createBrandState(stateRef.current, input);
      if (!result) return null;
      // Onboarding'de yüklenen profil görseli kalıcılaştırılır.
      const profileImageUrl = result.brand.profileImageUrl;
      if (
        profileImageUrl?.startsWith("blob:") &&
        !refByObjectUrl.current.has(profileImageUrl)
      ) {
        void persistUpload(profileImageUrl);
      }
      commit(result.state);
      return result.brand;
    },
    [commit, persistUpload],
  );

  const selectBrand = useCallback(
    (id: string) => {
      const next = selectBrandState(stateRef.current, id);
      if (!next) return;
      commit(next);
    },
    [commit],
  );

  const setExistingPosts = useCallback(
    (next: ExistingPost[] | ((prev: ExistingPost[]) => ExistingPost[])) => {
      const previousState = stateRef.current;
      const nextState = syncActiveProject({
        ...previousState,
        existingPosts:
          typeof next === "function" ? next(previousState.existingPosts) : next,
      });
      void cleanUpRemovedImages({
        previousState,
        nextState,
        refByObjectUrl: refByObjectUrl.current,
        trackedObjectUrls: trackedObjectUrls.current,
      });
      commit(nextState);
    },
    [commit],
  );

  const setPlannedPosts = useCallback(
    (next: PlannedPost[] | ((prev: PlannedPost[]) => PlannedPost[])) => {
      const previousState = stateRef.current;
      const nextState = syncActiveProject({
        ...previousState,
        plannedPosts:
          typeof next === "function" ? next(previousState.plannedPosts) : next,
      });
      void cleanUpRemovedImages({
        previousState,
        nextState,
        refByObjectUrl: refByObjectUrl.current,
        trackedObjectUrls: trackedObjectUrls.current,
      });
      commit(nextState);
    },
    [commit],
  );

  const resetToDefaults = useCallback(async () => {
    // Sunucu-side temizliği çağır
    const db = getSupabaseBrowserClient();
    const { data: { session } } = await db?.auth.getSession() ?? { data: { session: null } };
    if (session) {
      try {
        const response = await fetch(withBasePath("/api/workspace/clear-all"), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${session.access_token}`,
          },
        });
        if (!response.ok) {
          const error = await response.json().catch(() => ({ error: "Sunucu temizleme başarısız" }));
          console.error("[resetToDefaults] Sunucu temizleme hatası:", error);
          throw new Error(error.error || "Sunucu temizleme başarısız");
        }
      } catch (error) {
        console.error("[resetToDefaults] Sunucu temizleme başarısız:", error);
        throw error;
      }
    }

    // Yerel temizleme
    clearPersistedState(getBrowserStorage());
    await clearStoredImages();
    await clearStoredVideos();
    revokeTrackedObjectUrls({
      refByObjectUrl: refByObjectUrl.current,
      trackedObjectUrls: trackedObjectUrls.current,
    });
    // Sıfırlama sonrası persist efekti varsayılanları geri yazmasın:
    // depo, ilk açılışta olduğu gibi temiz kalmalı (onboarding).
    skipPersistRef.current = true;
    commit(getDefaultAppState());
  }, [commit]);

  const deleteBrand = useCallback(async (id: string) => {
    const session = (await getSupabaseBrowserClient()?.auth.getSession())?.data.session;
    if (!session) throw new Error("Markayı silmek için giriş yapın.");
    const response = await fetch(withBasePath(`/api/workspace/brands/${encodeURIComponent(id)}`), {
      method: "DELETE",
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new Error(body?.error || "Marka silinemedi.");
    }
    const next = removeBrandState(stateRef.current, id);
    skipPersistRef.current = true;
    clearPersistedState(getBrowserStorage());
    commit(next);
  }, [commit]);

  const selectProject = useCallback(
    (id: string) => {
      const next = selectProjectState(stateRef.current, id);
      if (!next) return;
      commit(next);
    },
    [commit],
  );

  const createProject = useCallback((name: string, month: number, year: number, copyPrevious: boolean): string | null => {
    const result = createProjectState(stateRef.current, name, month, year, copyPrevious);
    if ("error" in result) return result.error;
    commit(result.state);
    return null;
  }, [commit]);

  const copyPostToProject = useCallback(
    (postId: string, targetProjectId: string, options: PostCopyOptions): string | null => {
      const result = copyPostToProjectState(stateRef.current, postId, targetProjectId, options);
      if ("error" in result) return result.error;
      commit(result.state);
      return null;
    },
    [commit],
  );

  const copyHighlightToBrand = useCallback(
    (highlightId: string, targetBrandId: string): string | null => {
      const result = copyHighlightToBrandState(stateRef.current, highlightId, targetBrandId);
      if ("error" in result) return result.error;
      commit(result.state);
      return null;
    },
    [commit],
  );

  return {
    brand: state.brand,
    existingPosts: state.existingPosts,
    plannedPosts: state.plannedPosts,
    ready,
    syncError,
    brands: state.brands ?? [],
    activeBrandId: state.activeBrandId ?? "",
    createBrand,
    selectBrand,
    setBrand,
    updateBrand,
    setExistingPosts,
    setPlannedPosts,
    persistUpload,
    persistVideoUpload,
    resetToDefaults,
    deleteBrand,
    projects: (state.projects ?? []).filter(
      (project) =>
        !state.activeBrandId || !project.brandId || project.brandId === state.activeBrandId,
    ),
    allProjects: state.projects ?? [],
    copyPostToProject,
    copyHighlightToBrand,
    activeProjectId: state.activeProjectId ?? "",
    selectProject,
    createProject,
  };
}
