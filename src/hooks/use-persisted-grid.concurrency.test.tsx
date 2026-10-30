// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Eşzamanlı/bayat cihaz senaryoları (push öncesi inceleme bulguları S4–S8):
 * "veritabanı" paylaşılan sahte tablolardır; diğer cihazın işlemleri doğrudan
 * `fake.rows` üzerinde yapılır, bu test hook'u bayat/çevrimdışı cihazdır.
 */
const fake = vi.hoisted(() => ({
  rows: {} as Record<string, Array<Record<string, unknown>>>,
  deletes: [] as Array<{ table: string; ids: unknown[] }>,
  selects: 0,
  upsertedPostIds: [] as string[],
  failWrites: false,
}));

vi.mock("../lib/image-store", () => ({
  isImageRef: (value: string) => value.startsWith("idb:"),
  loadImageAsObjectUrl: vi.fn(), persistObjectUrl: vi.fn(), deleteStoredImage: vi.fn(), clearStoredImages: vi.fn(async () => undefined),
}));
vi.mock("../lib/video-store", () => ({
  isVideoRef: (value: string) => value.startsWith("idb-video:"),
  loadVideoAsObjectUrl: vi.fn(), persistVideoObjectUrl: vi.fn(), deleteStoredVideo: vi.fn(), clearStoredVideos: vi.fn(async () => undefined),
}));
vi.mock("../lib/supabase-browser", () => {
  const user = { id: "user-1" };
  const db = {
    auth: { getUser: async () => ({ data: { user } }), getSession: async () => ({ data: { session: { access_token: "t" } } }) },
    from: (table: string) => ({
      select: () => ({
        eq: () => {
          if (table !== "workspace_sync_state") fake.selects += 1;
          return Object.assign(Promise.resolve({ data: fake.rows[table] ?? [], error: null }), {
            maybeSingle: async () => ({ data: table === "workspace_sync_state" ? { restore_epoch: null } : (fake.rows[table] ?? [])[0] ?? null, error: null }),
          });
        },
      }),
      upsert: (rows: Record<string, unknown> | Array<Record<string, unknown>>) => {
        const list = Array.isArray(rows) ? rows : [rows];
        if (fake.failWrites) return Object.assign(Promise.resolve({ error: { message: "network down" } }), { select: async () => ({ data: null, error: { message: "network down" } }) });
        if (table === "workspace_posts") fake.upsertedPostIds.push(...list.map((row) => String(row.id)));
        const current = fake.rows[table] ?? (fake.rows[table] = []);
        for (const row of list) {
          const key = (row.id ?? row.user_id) as unknown;
          const at = current.findIndex((item) => (item.id ?? item.user_id) === key);
          if (at >= 0) current[at] = { ...current[at], ...row }; else current.push(row);
        }
        return Object.assign(Promise.resolve({ error: null }), { select: async () => ({ data: list.map((row) => ({ id: row.id, project_id: row.project_id })), error: null }) });
      },
      delete: () => ({ eq: () => ({ in: async (_c: string, ids: unknown[]) => { fake.deletes.push({ table, ids }); fake.rows[table] = (fake.rows[table] ?? []).filter((row) => !ids.includes(row.id)); return { error: null }; } }) }),
    }),
    storage: { from: () => ({ createSignedUrl: async (path: string) => ({ data: { signedUrl: `https://x.supabase.co/storage/v1/object/sign/workspace-media/${path}?token=${Math.random()}` }, error: null }) }) },
  };
  return { getSupabaseBrowserClient: () => db };
});

import { usePersistedGrid } from "./use-persisted-grid";

const post = (id: string, extra: Record<string, unknown> = {}) => ({
  user_id: "user-1", id, brand_id: "b1", project_id: "p1", source: "mevcut", image_path: `user-1/b1/${id}.jpg`,
  recency_index: 0, plan_order: null, pinned: false, caption: null, ...extra,
});
const BRAND = { id: "b1", user_id: "user-1", name: "Marka", username: "marka" };
const PROJECT = { id: "p1", user_id: "user-1", brand_id: "b1", name: "Ekim", month: 10, year: 2026, created_at: "2026-10-01T00:00:00.000Z", updated_at: "2026-10-01T00:00:00.000Z" };
const ids = (rows: Array<Record<string, unknown>>) => rows.map((row) => row.id as string).sort();
const caption = (id: string) => fake.rows.workspace_posts.find((row) => row.id === id)?.caption;

async function renderReady() {
  const hook = renderHook(() => usePersistedGrid());
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  await waitFor(() => expect(hook.result.current.existingPosts.length).toBeGreaterThan(0));
  return hook;
}
const wait = (ms = 40) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });
const focus = () => act(async () => { window.dispatchEvent(new Event("focus")); await new Promise((resolve) => setTimeout(resolve, 40)); });

beforeEach(() => {
  fake.rows = {
    workspace_brands: [BRAND], workspace_projects: [PROJECT], workspace_prefs: [{ user_id: "user-1", active_brand_id: "b1", active_project_id: "p1" }],
    workspace_posts: [post("x", { caption: "X" }), post("y", { recency_index: 1, caption: "Y" }), post("z", { recency_index: 2, caption: "Z" })],
  };
  fake.deletes = []; fake.selects = 0; fake.upsertedPostIds = []; fake.failWrites = false;
  localStorage.clear();
});
afterEach(cleanup);

describe("eşzamanlı düzenleme: bayat cihaz başkasının kaydını ezmez/diriltmez", () => {
  it("S4: A bir gönderiyi sildi; B yenilemeden başka gönderiyi düzenler → silinen gönderi geri gelmez", async () => {
    const { result } = await renderReady(); await wait();
    fake.rows.workspace_posts = fake.rows.workspace_posts.filter((row) => row.id !== "x");
    act(() => result.current.setExistingPosts((posts) => posts.map((item) => (item.id === "y" ? { ...item, caption: "B düzenledi" } : item))));
    await waitFor(() => expect(caption("y")).toBe("B düzenledi"));
    await wait();
    expect(ids(fake.rows.workspace_posts)).toEqual(["y", "z"]);
    expect(fake.upsertedPostIds).toEqual(["y"]);
  });

  it("S5: A bir caption'ı değiştirdi; B bayat durumdan başka gönderiyi düzenler → A'nın caption'ı ezilmez", async () => {
    const { result } = await renderReady(); await wait();
    fake.rows.workspace_posts = fake.rows.workspace_posts.map((row) => (row.id === "z" ? { ...row, caption: "A'nın yeni\n\ncaption'ı" } : row));
    act(() => result.current.setExistingPosts((posts) => posts.map((item) => (item.id === "y" ? { ...item, caption: "B düzenledi" } : item))));
    await waitFor(() => expect(caption("y")).toBe("B düzenledi"));
    await wait();
    expect(caption("z")).toBe("A'nın yeni\n\ncaption'ı");
  });

  it("B'nin sildiği gönderi silinir; A'nın bu sırada eklediği gönderiye ve diğerlerine dokunulmaz", async () => {
    const { result } = await renderReady(); await wait();
    fake.rows.workspace_posts.push(post("n", { recency_index: 3, caption: "A ekledi" }));
    act(() => result.current.setExistingPosts((posts) => posts.filter((item) => item.id !== "x")));
    await waitFor(() => expect(fake.deletes.some((item) => item.ids.includes("x"))).toBe(true));
    expect(fake.deletes.flatMap((item) => item.ids)).toEqual(["x"]);
    expect(ids(fake.rows.workspace_posts)).toEqual(["n", "y", "z"]);
  });
});

describe("çevrimdışı ve bayat açılış", () => {
  it("S6: yazım başarısız olunca bağlantı gelince (online) kullanıcı eylemi beklemeden yeniden denenir", async () => {
    const { result } = await renderReady(); await wait();
    fake.failWrites = true;
    act(() => result.current.setExistingPosts((posts) => posts.map((item) => (item.id === "y" ? { ...item, caption: "çevrimdışı" } : item))));
    await waitFor(() => expect(result.current.syncError).not.toBeNull());
    expect(caption("y")).toBe("Y");
    fake.failWrites = false;
    await act(async () => { window.dispatchEvent(new Event("online")); await new Promise((resolve) => setTimeout(resolve, 60)); });
    await waitFor(() => expect(caption("y")).toBe("çevrimdışı"));
    await waitFor(() => expect(result.current.syncError).toBeNull());
  });

  it("S7: başka cihazdan 'tümünü temizle' sonrası temiz eşitlenmiş eski kopya buluta geri yazılmaz", async () => {
    const first = await renderReady(); await wait(); first.unmount();
    fake.rows = { workspace_brands: [], workspace_projects: [], workspace_posts: [], workspace_prefs: [] };
    const { result } = renderHook(() => usePersistedGrid());
    await waitFor(() => expect(result.current.ready).toBe(true)); await wait(100);
    expect(result.current.brands).toHaveLength(0);
    expect(fake.rows.workspace_brands).toHaveLength(0);
    expect(fake.rows.workspace_posts).toHaveLength(0);
  });

  it("S8: yazımı başarısız yerel düzenleme yeniden açılışta kaybolmaz (bulut değişmediyse yerel kazanır)", async () => {
    const first = await renderReady(); await wait();
    fake.failWrites = true;
    act(() => first.result.current.setExistingPosts((posts) => posts.map((item) => (item.id === "y" ? { ...item, caption: "kaydedilemeyen\n\nuzun düzenleme" } : item))));
    await waitFor(() => expect(first.result.current.syncError).not.toBeNull());
    first.unmount(); fake.failWrites = false;
    const { result } = renderHook(() => usePersistedGrid());
    await waitFor(() => expect(result.current.ready).toBe(true));
    await waitFor(() => expect(caption("y")).toBe("kaydedilemeyen\n\nuzun düzenleme"));
    expect(result.current.existingPosts.find((item) => item.id === "y")?.caption).toBe("kaydedilemeyen\n\nuzun düzenleme");
    expect(fake.upsertedPostIds).toContain("y");
    expect(fake.upsertedPostIds).not.toContain("z");
  });

  it("S8b: hem yerel hem bulut değiştiyse (gerçek çakışma) bulut kazanır", async () => {
    const first = await renderReady(); await wait();
    fake.failWrites = true;
    act(() => first.result.current.setExistingPosts((posts) => posts.map((item) => (item.id === "y" ? { ...item, caption: "yerel" } : item))));
    await waitFor(() => expect(first.result.current.syncError).not.toBeNull());
    first.unmount(); fake.failWrites = false;
    fake.rows.workspace_posts = fake.rows.workspace_posts.map((row) => (row.id === "y" ? { ...row, caption: "bulut" } : row));
    const { result } = renderHook(() => usePersistedGrid());
    await waitFor(() => expect(result.current.ready).toBe(true));
    await waitFor(() => expect(result.current.existingPosts.find((item) => item.id === "y")?.caption).toBe("bulut"));
    expect(caption("y")).toBe("bulut");
  });

  it("S8c: çevrimdışıyken başka cihazda silinen, yerelde değişmemiş gönderi geri yazılmaz", async () => {
    const first = await renderReady(); await wait();
    fake.failWrites = true;
    act(() => first.result.current.setExistingPosts((posts) => posts.map((item) => (item.id === "z" ? { ...item, caption: "z düzenlendi" } : item))));
    await waitFor(() => expect(first.result.current.syncError).not.toBeNull());
    first.unmount(); fake.failWrites = false;
    fake.rows.workspace_posts = fake.rows.workspace_posts.filter((row) => row.id !== "x"); // A sildi
    const { result } = renderHook(() => usePersistedGrid());
    await waitFor(() => expect(result.current.ready).toBe(true));
    await waitFor(() => expect(caption("z")).toBe("z düzenlendi"));
    expect(ids(fake.rows.workspace_posts)).toEqual(["y", "z"]);
    expect(result.current.existingPosts.map((item) => item.id).sort()).toEqual(["y", "z"]);
  });
});

describe("yenileme yükü", () => {
  it("art arda odak olayları tek çekime indirilir (10 sn alt sınır)", async () => {
    await renderReady(); await wait();
    const before = fake.selects;
    for (let index = 0; index < 5; index += 1) await focus();
    expect(fake.selects - before).toBe(6); // tek tam çekim = 6 tablo sorgusu
  });
});
