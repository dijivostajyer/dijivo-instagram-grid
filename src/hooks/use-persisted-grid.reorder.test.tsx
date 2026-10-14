// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Grid sürükle-bırak sırası: hook → autosave → gerçek pushWorkspace →
 * sahte Supabase tabloları → yeni oturumda gerçek pullWorkspace. Sahte DB
 * upsert'leri saklar, böylece "reload" gerçek satırlardan okunur.
 */
const fake = vi.hoisted(() => ({
  tables: {} as Record<string, Map<string, Record<string, unknown>>>,
  prefsWrites: 0,
  /** Migration uygulanmamış DB'yi taklit eder: grid_order sütunu yok. */
  gridOrderColumnMissing: false,
}));

vi.mock("../lib/image-store", () => ({
  isImageRef: (value: string) => value.startsWith("idb:"),
  loadImageAsObjectUrl: vi.fn(), persistObjectUrl: vi.fn(), clearStoredImages: vi.fn(), deleteStoredImage: vi.fn(),
}));
vi.mock("../lib/video-store", () => ({
  isVideoRef: (value: string) => value.startsWith("idb-video:"),
  loadVideoAsObjectUrl: vi.fn(), persistVideoObjectUrl: vi.fn(), clearStoredVideos: vi.fn(), deleteStoredVideo: vi.fn(),
}));
vi.mock("../lib/supabase-browser", () => {
  const table = (name: string) => (fake.tables[name] ??= new Map());
  const rows = (name: string) => [...table(name).values()];
  const db = {
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
    from: (name: string) => ({
      select: () => ({
        eq: () => Object.assign(Promise.resolve({ data: rows(name), error: null }), {
          maybeSingle: async () => ({ data: rows(name)[0] ?? null, error: null }),
        }),
      }),
      upsert: (input: Record<string, unknown> | Array<Record<string, unknown>>) => {
        const list = Array.isArray(input) ? input : [input];
        if (name === "workspace_posts" && fake.gridOrderColumnMissing && list.some((row) => "grid_order" in row)) {
          const error = { code: "PGRST204", message: "Could not find the 'grid_order' column of 'workspace_posts' in the schema cache" };
          return Object.assign(Promise.resolve({ error }), { select: async () => ({ data: null, error }) });
        }
        for (const row of list) {
          const key = String(row.id ?? row.user_id);
          table(name).set(key, { ...table(name).get(key), ...row });
        }
        if (name === "workspace_prefs") fake.prefsWrites += 1;
        return Object.assign(Promise.resolve({ error: null }), {
          select: async () => ({ data: list.map((row) => ({ id: row.id, project_id: row.project_id })), error: null }),
        });
      },
    }),
    storage: {
      from: () => ({
        createSignedUrl: async (path: string) => ({ data: { signedUrl: `https://proj.supabase.co/storage/v1/object/sign/workspace-media/${path}?token=t` }, error: null }),
      }),
    },
  };
  return { getSupabaseBrowserClient: () => db };
});

import { usePersistedGrid } from "./use-persisted-grid";
import { computeGrid } from "../lib/grid";
import { reorderGridPosts } from "../lib/grid-reorder";

const post = (id: string, project: string, recency: number, extra: Record<string, unknown> = {}) => ({
  id, user_id: "user-1", brand_id: "brand-a", project_id: project, source: "mevcut",
  image_path: `user-1/brand-a/post/${id}.jpg`, recency_index: recency, pinned: false, ...extra,
});
const plan = (id: string, project: string, planOrder: number, extra: Record<string, unknown> = {}) => ({
  id, user_id: "user-1", brand_id: "brand-a", project_id: project, source: "planlanan",
  image_path: `user-1/brand-a/post/${id}.jpg`, plan_order: planOrder, pinned: false, ...extra,
});

function seed() {
  fake.tables = {
    workspace_brands: new Map([["brand-a", { id: "brand-a", user_id: "user-1", name: "Marka", username: "marka" }]]),
    workspace_projects: new Map([
      ["p-sep", { id: "p-sep", user_id: "user-1", brand_id: "brand-a", name: "Eylül", month: 9, year: 2026, created_at: "2026-09-01T00:00:00.000Z", updated_at: "2026-09-01T00:00:00.000Z" }],
      ["p-oct", { id: "p-oct", user_id: "user-1", brand_id: "brand-a", name: "Ekim", month: 10, year: 2026, created_at: "2026-10-01T00:00:00.000Z", updated_at: "2026-10-01T00:00:00.000Z" }],
    ]),
    // grid_order'sız eski kayıtlar: migration öncesi veriyi temsil eder.
    workspace_posts: new Map<string, Record<string, unknown>>([
      ["P1", post("P1", "p-oct", 10, { pinned: true, pinned_order: 0 })],
      ["P2", post("P2", "p-oct", 11, { pinned: true, pinned_order: 1 })],
      ["L1", plan("L1", "p-oct", 0)],
      ["L2", plan("L2", "p-oct", 1, { post_type: "reel" })],
      ["N1", post("N1", "p-oct", 0)],
      ["N2", post("N2", "p-oct", 1, { post_type: "reel" })],
      ["N3", post("N3", "p-oct", 2)],
      ["S1", post("S1", "p-sep", 0)],
      ["S2", post("S2", "p-sep", 1)],
    ]),
    workspace_prefs: new Map([["user-1", { user_id: "user-1", active_brand_id: "brand-a", active_project_id: "p-oct" }]]),
  };
}

type Hook = { current: ReturnType<typeof usePersistedGrid> };
const gridOrder = (result: Hook) =>
  computeGrid(result.current.existingPosts, result.current.plannedPosts).cells.map((cell) => cell.post.id);

async function renderReady() {
  const hook = renderHook(() => usePersistedGrid());
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  return hook;
}

async function saveAfter(change: () => void) {
  const before = fake.prefsWrites;
  act(change);
  await waitFor(() => expect(fake.prefsWrites).toBeGreaterThan(before));
}

/** GridManager.handleReorderGrid ile aynı: değişen dizileri state'e yazar. */
async function dragInGrid(result: Hook, activeId: string, overId: string) {
  const { existingPosts, plannedPosts } = result.current;
  const next = reorderGridPosts(existingPosts, plannedPosts, activeId, overId);
  if (!next) return false;
  if (next.existingPosts !== existingPosts) await saveAfter(() => result.current.setExistingPosts(next.existingPosts));
  if (next.plannedPosts !== plannedPosts) await saveAfter(() => result.current.setPlannedPosts(next.plannedPosts));
  return true;
}

const MIXED = ["P2", "P1", "L2", "N3", "L1", "N1", "N2"];

async function mixOctober(result: Hook) {
  expect(gridOrder(result)).toEqual(["P1", "P2", "L1", "L2", "N1", "N2", "N3"]);
  expect(await dragInGrid(result, "N3", "L1")).toBe(true); // mevcut → planlanan önüne
  expect(gridOrder(result)).toEqual(["P1", "P2", "N3", "L1", "L2", "N1", "N2"]);
  expect(await dragInGrid(result, "L2", "N3")).toBe(true); // planlanan → mevcut önüne
  expect(await dragInGrid(result, "P2", "P1")).toBe(true); // pinned kendi arasında
  expect(gridOrder(result)).toEqual(MIXED);
}

beforeEach(() => {
  seed();
  fake.prefsWrites = 0;
  fake.gridOrderColumnMissing = false;
  localStorage.clear();
});
afterEach(cleanup);

describe("ortak grid sırası kalıcılığı", () => {
  it("H. ay değiştirip geri dönünce karma sıra korunur; diğer ayın sırası karışmaz", async () => {
    const { result } = await renderReady();
    await mixOctober(result);
    await saveAfter(() => result.current.selectProject("p-sep"));
    expect(gridOrder(result)).toEqual(["S1", "S2"]);
    await saveAfter(() => result.current.selectProject("p-oct"));
    expect(gridOrder(result)).toEqual(MIXED);
  });

  it("G. reload sonrası (yeni oturum, DB'den okuma) karma sıra ve içerik türleri korunur", async () => {
    const first = await renderReady();
    await mixOctober(first.result);
    first.unmount();
    localStorage.clear(); // yalnız uzak kayıttan okunduğunu garanti et

    expect(fake.tables.workspace_posts.get("L2")).toMatchObject({ source: "planlanan", grid_order: 0 });
    expect(fake.tables.workspace_posts.get("N3")).toMatchObject({ source: "mevcut", grid_order: 1 });

    const second = await renderReady();
    expect(gridOrder(second.result)).toEqual(MIXED);
    expect(second.result.current.plannedPosts.map((item) => item.id).sort()).toEqual(["L1", "L2"]);
    expect(second.result.current.existingPosts.every((item) => item.source === "mevcut")).toBe(true);
    expect(second.result.current.plannedPosts.find((item) => item.id === "L2")?.postType).toBe("reel");
    await saveAfter(() => second.result.current.selectProject("p-sep"));
    expect(gridOrder(second.result)).toEqual(["S1", "S2"]);
  });

  it("geçersiz bölge taşıması state'i değiştirmez", async () => {
    const { result } = await renderReady();
    const before = result.current.existingPosts;
    expect(await dragInGrid(result, "N2", "P1")).toBe(false);
    expect(await dragInGrid(result, "L1", "P2")).toBe(false);
    expect(await dragInGrid(result, "P1", "N3")).toBe(false);
    expect(result.current.existingPosts).toBe(before);
  });

  // Modül düzeyindeki "sütun yok" bayrağı kalıcı olduğu için en sonda.
  it("migration uygulanmamışsa (grid_order sütunu yok) senkron durmaz; satırlar sütunsuz yazılır", async () => {
    fake.gridOrderColumnMissing = true;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { result } = await renderReady();
    await mixOctober(result);
    expect(result.current.syncError).toBeNull();
    expect(fake.tables.workspace_posts.get("N3")).not.toHaveProperty("grid_order");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("grid_order"));
    warn.mockRestore();
  });
});
