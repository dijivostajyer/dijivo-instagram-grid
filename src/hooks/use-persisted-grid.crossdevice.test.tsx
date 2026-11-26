// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Cihazlar arası senkron: "veritabanı" iki cihaz arasında paylaşılan sahte
 * tablolardır. Cihaz B = bu test; cihaz A'nın yaptığı değişiklikler doğrudan
 * `fake.rows` üzerinde yapılır.
 */
const fake = vi.hoisted(() => ({
  rows: {} as Record<string, Array<Record<string, unknown>>>,
  deletes: [] as Array<{ table: string; ids: unknown[] }>,
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
        eq: () => Object.assign(Promise.resolve({ data: fake.rows[table] ?? [], error: null }), {
          maybeSingle: async () => ({ data: table === "workspace_sync_state" ? { restore_epoch: null } : (fake.rows[table] ?? [])[0] ?? null, error: null }),
        }),
      }),
      upsert: (rows: Record<string, unknown> | Array<Record<string, unknown>>) => {
        const list = Array.isArray(rows) ? rows : [rows];
        const current = fake.rows[table] ?? (fake.rows[table] = []);
        for (const row of list) {
          const key = (row.id ?? row.user_id) as unknown;
          const at = current.findIndex((item) => (item.id ?? item.user_id) === key);
          if (at >= 0) current[at] = { ...current[at], ...row };
          else current.push(row);
        }
        return Object.assign(Promise.resolve({ error: null }), {
          select: async () => ({ data: list.map((row) => ({ id: row.id, project_id: row.project_id })), error: null }),
        });
      },
      delete: () => ({
        eq: () => ({
          in: async (_column: string, ids: unknown[]) => {
            fake.deletes.push({ table, ids });
            fake.rows[table] = (fake.rows[table] ?? []).filter((row) => !ids.includes(row.id));
            return { error: null };
          },
        }),
      }),
    }),
    storage: { from: () => ({ createSignedUrl: async (path: string) => ({ data: { signedUrl: `https://x.supabase.co/storage/v1/object/sign/workspace-media/${path}?token=1` }, error: null }) }) },
  };
  return { getSupabaseBrowserClient: () => db };
});

import { usePersistedGrid } from "./use-persisted-grid";
import { STORAGE_KEY } from "../lib/storage";
import { writeSyncClean } from "../lib/workspace-sync";

const post = (id: string, extra: Record<string, unknown> = {}) => ({
  user_id: "user-1", id, brand_id: "b1", project_id: "p1", source: "mevcut", image_path: `user-1/b1/${id}.jpg`,
  recency_index: 0, plan_order: null, pinned: false, caption: null, ...extra,
});
const BRAND = { id: "b1", user_id: "user-1", name: "Marka", username: "marka" };
const PROJECT = { id: "p1", user_id: "user-1", brand_id: "b1", name: "Ekim", month: 10, year: 2026, created_at: "2026-10-01T00:00:00.000Z", updated_at: "2026-10-01T00:00:00.000Z" };

async function renderReady() {
  const hook = renderHook(() => usePersistedGrid());
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  await waitFor(() => expect(hook.result.current.existingPosts.length + hook.result.current.plannedPosts.length).toBeGreaterThan(0));
  return hook;
}

const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });

beforeEach(() => {
  fake.rows = {
    workspace_brands: [BRAND], workspace_projects: [PROJECT], workspace_prefs: [{ user_id: "user-1", active_brand_id: "b1", active_project_id: "p1" }],
    workspace_posts: [post("a", { caption: "ilk" }), post("b", { recency_index: 1 })],
  };
  fake.deletes = [];
  localStorage.clear();
});
afterEach(cleanup);

describe("cihazlar arası senkron", () => {
  it("temiz eşitlenmiş bayat yerel kopya açılışta uzak veriyle ezilir; uzakta silinen gönderi geri gelmez", async () => {
    // Cihaz B ilk kez açıldı (a, b görünür) ve temiz eşitlendi.
    const first = await renderReady();
    await waitFor(() => expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull());
    first.unmount();
    writeSyncClean(localStorage, "user-1", true);
    // Cihaz A "b"yi sildi ve "a"nın caption'ını değiştirdi.
    fake.rows.workspace_posts = [post("a", { caption: "A cihazında\n\nyeni metin" })];

    const { result } = await renderReady();
    expect(result.current.existingPosts.map((item) => item.id)).toEqual(["a"]);
    expect(result.current.existingPosts[0].caption).toBe("A cihazında\n\nyeni metin");
    await flush();
    expect(fake.rows.workspace_posts.map((row) => row.id)).toEqual(["a"]);
  });

  it("bu cihazda silinen gönderi buluttan da silinir (diğer cihaz görür)", async () => {
    const { result } = await renderReady();
    act(() => result.current.setExistingPosts((posts) => posts.filter((item) => item.id !== "b")));
    await waitFor(() => expect(fake.deletes.some((item) => item.table === "workspace_posts" && item.ids.includes("b"))).toBe(true));
    expect(fake.rows.workspace_posts.map((row) => row.id)).toEqual(["a"]);
  });

  it("açık sekme, başka cihazın değişikliğini odaklanınca çeker (yenilemeden)", async () => {
    const { result } = await renderReady();
    await flush();
    fake.rows.workspace_posts = [post("a", { caption: "Satır 1\nSatır 2\n\nSatır 4" }), post("b", { recency_index: 1 }), post("c", { recency_index: 2 })];
    await act(async () => { window.dispatchEvent(new Event("focus")); await new Promise((resolve) => setTimeout(resolve, 30)); });
    await waitFor(() => expect(result.current.existingPosts.map((item) => item.id).sort()).toEqual(["a", "b", "c"]));
    expect(result.current.existingPosts.find((item) => item.id === "a")?.caption).toBe("Satır 1\nSatır 2\n\nSatır 4");
  });

  it("kullanıcı metin alanında yazarken uzak durum uygulanmaz (imleç/taslak korunur)", async () => {
    const { result } = await renderReady();
    await flush();
    const textarea = document.createElement("textarea");
    document.body.appendChild(textarea);
    textarea.focus();
    fake.rows.workspace_posts = [post("a", { caption: "uzak" })];
    await act(async () => { window.dispatchEvent(new Event("focus")); await new Promise((resolve) => setTimeout(resolve, 30)); });
    expect(result.current.existingPosts.find((item) => item.id === "a")?.caption).toBe("ilk");
    textarea.remove();
  });

  it("caption satır sonları ve boş satırlar buluta aynen yazılır", async () => {
    const { result } = await renderReady();
    const caption = "Birinci satır\nİkinci satır\n\nÜçüncü satır  ";
    act(() => result.current.setExistingPosts((posts) => posts.map((item) => (item.id === "a" ? { ...item, caption } : item))));
    await waitFor(() => expect(fake.rows.workspace_posts.find((row) => row.id === "a")?.caption).toBe(caption));
  });
});
