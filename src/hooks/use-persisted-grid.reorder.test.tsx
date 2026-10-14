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

function seed() {
  fake.tables = {
    workspace_brands: new Map([["brand-a", { id: "brand-a", user_id: "user-1", name: "Marka", username: "marka" }]]),
    workspace_projects: new Map([
      ["p-sep", { id: "p-sep", user_id: "user-1", brand_id: "brand-a", name: "Eylül", month: 9, year: 2026, created_at: "2026-09-01T00:00:00.000Z", updated_at: "2026-09-01T00:00:00.000Z" }],
      ["p-oct", { id: "p-oct", user_id: "user-1", brand_id: "brand-a", name: "Ekim", month: 10, year: 2026, created_at: "2026-10-01T00:00:00.000Z", updated_at: "2026-10-01T00:00:00.000Z" }],
    ]),
    workspace_posts: new Map([
      ["P1", post("P1", "p-oct", 10, { pinned: true, pinned_order: 0 })],
      ["P2", post("P2", "p-oct", 11, { pinned: true, pinned_order: 1 })],
      ["N1", post("N1", "p-oct", 0)],
      ["N2", post("N2", "p-oct", 1, { post_type: "reel" })],
      ["N3", post("N3", "p-oct", 2)],
      ["S1", post("S1", "p-sep", 0)],
      ["S2", post("S2", "p-sep", 1)],
    ]),
    workspace_prefs: new Map([["user-1", { user_id: "user-1", active_brand_id: "brand-a", active_project_id: "p-oct" }]]),
  };
}

const gridOrder = (result: { current: ReturnType<typeof usePersistedGrid> }) =>
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

function dragInGrid(result: { current: ReturnType<typeof usePersistedGrid> }, activeId: string, overId: string) {
  const next = reorderGridPosts(result.current.existingPosts, result.current.plannedPosts, activeId, overId);
  if (!next) return false;
  result.current.setExistingPosts(next.existingPosts);
  return true;
}

beforeEach(() => {
  seed();
  fake.prefsWrites = 0;
  localStorage.clear();
});
afterEach(cleanup);

describe("grid sırası kalıcılığı", () => {
  it("G. ay değiştirip geri dönünce sıra korunur; diğer ayın sırası karışmaz", async () => {
    const { result } = await renderReady();
    expect(gridOrder(result)).toEqual(["P1", "P2", "N1", "N2", "N3"]);

    await saveAfter(() => { expect(dragInGrid(result, "N3", "N1")).toBe(true); });
    await saveAfter(() => { expect(dragInGrid(result, "P2", "P1")).toBe(true); });
    expect(gridOrder(result)).toEqual(["P2", "P1", "N3", "N1", "N2"]);

    await saveAfter(() => result.current.selectProject("p-sep"));
    expect(gridOrder(result)).toEqual(["S1", "S2"]);
    await saveAfter(() => result.current.selectProject("p-oct"));
    expect(gridOrder(result)).toEqual(["P2", "P1", "N3", "N1", "N2"]);
  });

  it("H. reload sonrası (yeni oturum, DB'den okuma) sıra korunur", async () => {
    const first = await renderReady();
    await saveAfter(() => { dragInGrid(first.result, "N3", "N1"); });
    await saveAfter(() => { dragInGrid(first.result, "P2", "P1"); });
    first.unmount();
    localStorage.clear(); // yalnız uzak kayıttan okunduğunu garanti et

    const second = await renderReady();
    expect(gridOrder(second.result)).toEqual(["P2", "P1", "N3", "N1", "N2"]);
    const reel = second.result.current.existingPosts.find((item) => item.id === "N2");
    expect(reel?.postType).toBe("reel");
    expect(second.result.current.existingPosts.every((item) => item.source === "mevcut")).toBe(true);
    // Eylül etkilenmedi.
    await saveAfter(() => second.result.current.selectProject("p-sep"));
    expect(gridOrder(second.result)).toEqual(["S1", "S2"]);
  });

  it("geçersiz bölge taşıması state'i ve kaydı değiştirmez", async () => {
    const { result } = await renderReady();
    const before = result.current.existingPosts;
    expect(dragInGrid(result, "N2", "P1")).toBe(false);
    expect(dragInGrid(result, "P1", "N3")).toBe(false);
    expect(result.current.existingPosts).toBe(before);
  });
});
