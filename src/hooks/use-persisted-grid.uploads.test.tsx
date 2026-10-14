// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Autosave → pushWorkspace → workspace-media yükleme zincirini gerçek
 * workspace-store ve workspace-media-store ile çalıştırır; yalnız Supabase
 * istemcisi ve tarayıcı IndexedDB katmanları sahtedir. Amaç, aynı medyanın
 * her otomatik kayıtta Storage'a yeniden yüklenmediğini kanıtlamaktır.
 */
const fake = vi.hoisted(() => ({
  rows: {} as Record<string, Array<Record<string, unknown>>>,
  uploads: [] as string[],
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
  const user = { id: "user-1" };
  const query = (table: string) => {
    const result = () => ({ data: fake.rows[table] ?? [], error: null });
    const builder = {
      eq: () => Object.assign(Promise.resolve(result()), { maybeSingle: async () => ({ data: (fake.rows[table] ?? [])[0] ?? null, error: null }) }),
    };
    return builder;
  };
  const db = {
    auth: { getUser: async () => ({ data: { user } }) },
    from: (table: string) => ({
      select: () => query(table),
      upsert: (rows: Record<string, unknown> | Array<Record<string, unknown>>) => {
        if (table === "workspace_prefs") fake.prefsWrites += 1;
        const list = Array.isArray(rows) ? rows : [rows];
        const done = { error: null };
        return Object.assign(Promise.resolve(done), {
          select: async () => ({ data: list.map((row) => ({ id: row.id, project_id: row.project_id })), error: null }),
        });
      },
    }),
    storage: {
      from: () => ({
        createSignedUploadUrl: async (path: string) => ({ data: { path, token: "token" }, error: null }),
        uploadToSignedUrl: async (path: string) => { fake.uploads.push(path); return { data: { path }, error: null }; },
        createSignedUrl: async (path: string) => ({ data: { signedUrl: `https://proj.supabase.co/storage/v1/object/sign/workspace-media/${path}?token=t` }, error: null }),
      }),
    },
  };
  return { getSupabaseBrowserClient: () => db };
});

import { usePersistedGrid } from "./use-persisted-grid";
import type { ExistingPost } from "../lib/types";

const BRAND_ROW = { id: "brand-a", user_id: "user-1", name: "Marka", username: "marka" };
const PROJECT_ROW = { id: "p-oct", user_id: "user-1", brand_id: "brand-a", name: "Ekim", month: 10, year: 2026, created_at: "2026-10-01T00:00:00.000Z", updated_at: "2026-10-01T00:00:00.000Z" };
const PREFS_ROW = { user_id: "user-1", active_brand_id: "brand-a", active_project_id: "p-oct" };

async function renderReady() {
  const hook = renderHook(() => usePersistedGrid());
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  return hook;
}

/** Bir state değişikliği yapar ve tetiklediği autosave'in bitmesini bekler. */
async function saveAfter(change: () => void) {
  const before = fake.prefsWrites;
  act(change);
  await waitFor(() => expect(fake.prefsWrites).toBeGreaterThan(before));
}

beforeEach(() => {
  fake.rows = { workspace_brands: [BRAND_ROW], workspace_projects: [PROJECT_ROW], workspace_prefs: [PREFS_ROW] };
  fake.uploads = [];
  fake.prefsWrites = 0;
  localStorage.clear();
  vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(new Blob(["x"], { type: url.includes("video") ? "video/mp4" : "image/jpeg" }))));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("autosave medya yüklemesi", () => {
  it("blob görsel ilk kayıtta 1 kez yüklenir, sonraki kayıtlarda tekrar yüklenmez", async () => {
    const { result } = await renderReady();
    const post: ExistingPost = { id: "post-1", source: "mevcut", imageUrl: "blob:https://app.test/image-1", recencyIndex: 0, pinned: false };

    await saveAfter(() => result.current.setExistingPosts([post]));
    expect(fake.uploads).toHaveLength(1);

    await saveAfter(() => result.current.setExistingPosts((posts) => posts.map((item) => ({ ...item, caption: "Merhaba" }))));
    await saveAfter(() => result.current.setExistingPosts((posts) => posts.map((item) => ({ ...item, caption: "Merhaba dünya" }))));
    expect(fake.uploads).toHaveLength(1);
  });

  it("Reel video + aynı blob kapak: her medya tek kez yüklenir", async () => {
    const { result } = await renderReady();
    const reel: ExistingPost = {
      id: "reel-1", source: "mevcut", recencyIndex: 0, pinned: false, postType: "reel", mediaType: "video",
      imageUrl: "blob:https://app.test/cover-1", coverImageUrl: "blob:https://app.test/cover-1", videoUrl: "blob:https://app.test/video-1",
    };

    await saveAfter(() => result.current.setExistingPosts([reel]));
    await saveAfter(() => result.current.setExistingPosts((posts) => posts.map((item) => ({ ...item, caption: "Reel" }))));

    expect(fake.uploads.filter((path) => path.includes("/video/"))).toHaveLength(1);
    expect(fake.uploads.filter((path) => !path.includes("/video/"))).toHaveLength(1);
  });

  it("başarısız yükleme önbelleğe takılmaz; sonraki kayıt yeniden dener", async () => {
    const { result } = await renderReady();
    const post: ExistingPost = { id: "post-f", source: "mevcut", imageUrl: "blob:https://app.test/flaky", recencyIndex: 0, pinned: false };
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 500 }));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    act(() => result.current.setExistingPosts([post]));
    await waitFor(() => expect(result.current.syncError).not.toBeNull());
    expect(fake.uploads).toHaveLength(0);

    await saveAfter(() => result.current.setExistingPosts((posts) => posts.map((item) => ({ ...item, caption: "Tekrar" }))));
    expect(fake.uploads).toHaveLength(1);
    consoleError.mockRestore();
  });

  it("aynı blob başka markanın planına kopyalanırsa o marka kendi Storage nesnesini alır", async () => {
    fake.rows.workspace_brands = [BRAND_ROW, { ...BRAND_ROW, id: "brand-b", name: "B", username: "b" }];
    fake.rows.workspace_projects = [PROJECT_ROW, { ...PROJECT_ROW, id: "p-b", brand_id: "brand-b" }];
    const { result } = await renderReady();
    const post: ExistingPost = { id: "post-x", source: "mevcut", imageUrl: "blob:https://app.test/shared", recencyIndex: 0, pinned: false };

    await saveAfter(() => result.current.setExistingPosts([post]));
    await saveAfter(() => { result.current.copyPostToProject("post-x", "p-b", { caption: true, postType: true, hashtags: true, pinned: false }); });
    await saveAfter(() => result.current.setExistingPosts((posts) => posts.map((item) => ({ ...item, caption: "x" }))));

    expect(fake.uploads.map((path) => path.split("/")[1]).sort()).toEqual(["brand-a", "brand-b"]);
  });

  it("reload edilmiş workspace medyası tekrar yüklenmez", async () => {
    fake.rows.workspace_posts = [{
      id: "post-r", user_id: "user-1", brand_id: "brand-a", project_id: "p-oct", source: "mevcut",
      image_path: "user-1/brand-a/post/a.jpg", video_path: "user-1/brand-a/video/v.mp4", cover_path: "user-1/brand-a/cover/c.jpg",
      media_type: "video", post_type: "reel", recency_index: 0, pinned: false,
    }];
    const { result } = await renderReady();
    expect(result.current.existingPosts[0].imageUrl).toContain("/object/sign/workspace-media/user-1/brand-a/post/a.jpg");

    await saveAfter(() => result.current.setExistingPosts((posts) => posts.map((item) => ({ ...item, caption: "Yeniden" }))));
    expect(fake.uploads).toEqual([]);
  });
});
