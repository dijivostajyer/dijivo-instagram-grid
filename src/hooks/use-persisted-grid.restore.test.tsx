// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * AE. Geri yükleme sonrası yerel durum: bayat localStorage/IndexedDB kopyası
 * buluta geri yazılmaz, uygulama buluttan yeniden hydrate edilir; açık
 * sekme/cihaz epoch değişimini fark edip otomatik kaydı durdurur.
 */
const fake = vi.hoisted(() => ({
  rows: {} as Record<string, Array<Record<string, unknown>>>,
  epoch: null as string | null,
  upserts: [] as Array<{ table: string; ids: unknown[] }>,
  clearedImages: 0,
  clearedVideos: 0,
}));

vi.mock("../lib/image-store", () => ({
  isImageRef: (value: string) => value.startsWith("idb:"),
  loadImageAsObjectUrl: vi.fn(), persistObjectUrl: vi.fn(), deleteStoredImage: vi.fn(),
  clearStoredImages: vi.fn(async () => { fake.clearedImages += 1; }),
}));
vi.mock("../lib/video-store", () => ({
  isVideoRef: (value: string) => value.startsWith("idb-video:"),
  loadVideoAsObjectUrl: vi.fn(), persistVideoObjectUrl: vi.fn(), deleteStoredVideo: vi.fn(),
  clearStoredVideos: vi.fn(async () => { fake.clearedVideos += 1; }),
}));
vi.mock("../lib/supabase-browser", () => {
  const user = { id: "user-1" };
  const query = (table: string) => ({
    eq: () => Object.assign(Promise.resolve({ data: fake.rows[table] ?? [], error: null }), {
      maybeSingle: async () => {
        if (table === "workspace_sync_state") return { data: { restore_epoch: fake.epoch }, error: null };
        return { data: (fake.rows[table] ?? [])[0] ?? null, error: null };
      },
    }),
  });
  const db = {
    auth: { getUser: async () => ({ data: { user } }), getSession: async () => ({ data: { session: { access_token: "t" } } }) },
    from: (table: string) => ({
      select: () => query(table),
      upsert: (rows: Record<string, unknown> | Array<Record<string, unknown>>) => {
        const list = Array.isArray(rows) ? rows : [rows];
        fake.upserts.push({ table, ids: list.map((row) => row.id ?? row.user_id) });
        return Object.assign(Promise.resolve({ error: null }), {
          select: async () => ({ data: list.map((row) => ({ id: row.id, project_id: row.project_id })), error: null }),
        });
      },
    }),
    storage: { from: () => ({}) },
  };
  return { getSupabaseBrowserClient: () => db };
});

import { usePersistedGrid } from "./use-persisted-grid";
import { createBrandState, getDefaultAppState } from "../lib/brand-ops";
import { RESTORE_EPOCH_KEY, RESTORE_NOTICE_KEY, RESTORED_ELSEWHERE_MESSAGE } from "../lib/backup/restore-sync";
import { STORAGE_KEY, toPersistableState, writePersistedState } from "../lib/storage";

const BRAND_ROW = { id: "brand-restored", user_id: "user-1", name: "Geri Yüklenen", username: "geri" };
const PROJECT_ROW = { id: "p-oct", user_id: "user-1", brand_id: "brand-restored", name: "Ekim", month: 10, year: 2026, created_at: "2026-10-01T00:00:00.000Z", updated_at: "2026-10-01T00:00:00.000Z" };
const PREFS_ROW = { user_id: "user-1", active_brand_id: "brand-restored", active_project_id: "p-oct" };

function seedLocalOnlyBrand() {
  const created = createBrandState(getDefaultAppState(), { name: "Yerel Bayat", username: "bayat" })!;
  writePersistedState(localStorage, toPersistableState(created.state, new Map()));
  return created.brand.id;
}

const upsertedBrandIds = () => fake.upserts.filter((item) => item.table === "workspace_brands").flatMap((item) => item.ids);

async function renderReady() {
  const hook = renderHook(() => usePersistedGrid());
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  return hook;
}

beforeEach(() => {
  fake.rows = { workspace_brands: [BRAND_ROW], workspace_projects: [PROJECT_ROW], workspace_prefs: [PREFS_ROW] };
  fake.epoch = null;
  fake.upserts = [];
  fake.clearedImages = 0;
  fake.clearedVideos = 0;
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => {
  cleanup();
});

describe("AE. geri yükleme sonrası yerel durum", () => {
  it("epoch değiştiyse bayat yerel kopya atılır, buluta geri yazılmaz; uygulama buluttan hydrate olur", async () => {
    const staleBrandId = seedLocalOnlyBrand();
    localStorage.setItem(RESTORE_EPOCH_KEY, "epoch-old");
    fake.epoch = "epoch-new";

    const { result } = await renderReady();
    expect(result.current.brands.map((brand) => brand.id)).toEqual(["brand-restored"]);
    expect(upsertedBrandIds()).not.toContain(staleBrandId);
    expect(localStorage.getItem(RESTORE_EPOCH_KEY)).toBe("epoch-new");
    expect(fake.clearedImages).toBe(1);
    expect(fake.clearedVideos).toBe(1);
  });

  it("epoch aynıysa (veya hiç geri yükleme yoksa) eski uzlaştırma davranışı sürer", async () => {
    const localBrandId = seedLocalOnlyBrand();
    fake.epoch = null;
    const { result } = await renderReady();
    expect(result.current.brands.map((brand) => brand.id)).toEqual(["brand-restored", localBrandId]);
    expect(upsertedBrandIds()).toContain(localBrandId);
    expect(fake.clearedImages).toBe(0);
  });

  it("prepareForRemoteReload: kayıt durur, localStorage + IndexedDB temizlenir, epoch ve bildirim yazılır", async () => {
    const { result } = await renderReady();
    expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull();
    await act(async () => { await result.current.prepareForRemoteReload("epoch-restored"); });
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(RESTORE_EPOCH_KEY)).toBe("epoch-restored");
    expect(sessionStorage.getItem(RESTORE_NOTICE_KEY)).toBe("1");
    expect(fake.clearedImages).toBe(1);

    const before = fake.upserts.length;
    act(() => result.current.selectProject("p-oct"));
    act(() => result.current.setBrand({ ...result.current.brand, bio: "geri yükleme sonrası düzenleme" }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fake.upserts.length).toBe(before);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("aynı tarayıcıda başka sekme geri yükleme yaptıysa bu sekme localStorage'a ve buluta yazmaz", async () => {
    fake.epoch = "epoch-1";
    const { result } = await renderReady();
    localStorage.setItem(RESTORE_EPOCH_KEY, "epoch-2");
    localStorage.removeItem(STORAGE_KEY);
    const before = fake.upserts.length;
    act(() => result.current.setBrand({ ...result.current.brand, bio: "bayat sekme" }));
    await waitFor(() => expect(result.current.syncError).toBe(RESTORED_ELSEWHERE_MESSAGE));
    expect(fake.upserts.length).toBe(before);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("başka cihazda geri yükleme yapıldıysa (sunucu epoch'u değişti) otomatik kayıt buluta yazmaz", async () => {
    fake.epoch = "epoch-1";
    const { result } = await renderReady();
    fake.epoch = "epoch-2";
    const before = fake.upserts.length;
    act(() => result.current.setBrand({ ...result.current.brand, bio: "eski cihaz" }));
    await waitFor(() => expect(result.current.syncError).toBe(RESTORED_ELSEWHERE_MESSAGE));
    expect(fake.upserts.length).toBe(before);
  });
});
