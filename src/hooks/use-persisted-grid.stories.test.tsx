// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SIGN_BASE = "https://proj.supabase.co/storage/v1/object/sign/workspace-media/";
const BRAND = { id: "brand-a", name: "Marka", username: "marka" };

const mocks = vi.hoisted(() => ({
  remote: null as unknown,
  removed: [] as string[][],
  deletes: [] as Array<Record<string, string>>,
  duplicate: vi.fn(),
  upload: vi.fn(),
  copyCounter: 0,
}));

vi.mock("../lib/image-store", () => ({
  isImageRef: (value: string) => value.startsWith("idb:"),
  loadImageAsObjectUrl: vi.fn(), persistObjectUrl: vi.fn(), clearStoredImages: vi.fn(), deleteStoredImage: vi.fn(),
}));
vi.mock("../lib/video-store", () => ({
  isVideoRef: (value: string) => value.startsWith("idb-video:"),
  loadVideoAsObjectUrl: vi.fn(), persistVideoObjectUrl: vi.fn(), clearStoredVideos: vi.fn(), deleteStoredVideo: vi.fn(),
}));
vi.mock("../lib/workspace-store", () => ({
  pullWorkspace: vi.fn(async () => mocks.remote),
  pushWorkspace: vi.fn(async (_user: unknown, state: unknown) => state),
  reconcileWorkspaceState: (remote: unknown) => remote,
}));
vi.mock("../lib/workspace-media-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/workspace-media-store")>();
  return {
    ...actual,
    resolveWorkspaceMedia: vi.fn(async (ref: string) => `${SIGN_BASE}${actual.workspaceMediaPath(ref)}?token=t`),
    duplicateWorkspaceMedia: mocks.duplicate,
    uploadWorkspaceMedia: mocks.upload,
  };
});
vi.mock("../lib/supabase-browser", () => {
  const deleteChain = () => {
    const filters: Record<string, string> = {};
    const chain = {
      eq(column: string, value: string) {
        filters[column] = value;
        if (Object.keys(filters).length === 3) {
          mocks.deletes.push(filters);
          return Promise.resolve({ error: null });
        }
        return chain;
      },
    };
    return chain;
  };
  const db = {
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
    from: () => ({ delete: deleteChain }),
    storage: { from: () => ({ remove: async (paths: string[]) => { mocks.removed.push(paths); return { error: null }; } }) },
  };
  return { getSupabaseBrowserClient: () => db };
});

import { usePersistedGrid } from "./use-persisted-grid";
import { STORAGE_VERSION, type PersistedAppState } from "../lib/storage";

function remoteWithOctoberStory(): PersistedAppState {
  const october = {
    id: "p-oct", name: "Ekim", month: 10, year: 2026,
    createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z",
    brandId: BRAND.id, brand: BRAND, existingPosts: [], plannedPosts: [],
    stories: [{ id: "s-oct", mediaType: "image" as const, mediaUrl: "storage:workspace-media/user-1/brand-a/story/orig.jpg", createdAt: "2026-10-02T00:00:00.000Z", sortOrder: 0 }],
  };
  return {
    version: STORAGE_VERSION, brand: BRAND, brands: [BRAND], activeBrandId: BRAND.id,
    projects: [october], activeProjectId: "p-oct", existingPosts: [], plannedPosts: [],
  };
}

function projectByMonth(result: { current: ReturnType<typeof usePersistedGrid> }, month: number) {
  return result.current.allProjects.find((project) => project.month === month)!;
}

beforeEach(() => {
  mocks.remote = remoteWithOctoberStory();
  mocks.removed = [];
  mocks.deletes = [];
  mocks.copyCounter = 0;
  localStorage.clear();
  mocks.duplicate.mockReset().mockImplementation(async (_value: string, purpose: string) => `storage:workspace-media/user-1/${purpose}/copy-${++mocks.copyCounter}.jpg`);
  mocks.upload.mockReset().mockImplementation(async (_value: string, purpose: string) => `storage:workspace-media/user-1/${purpose}/new.jpg`);
});
afterEach(cleanup);

describe("aylık Story'ler", () => {
  it("Story yalnız aktif aya eklenir ve blob URL kalıcı saklanmaz", async () => {
    const { result } = renderHook(() => usePersistedGrid());
    await waitFor(() => expect(result.current.ready).toBe(true));
    act(() => { result.current.createProject("Kasım", 11, 2026, false); });
    const revoke = vi.fn();
    vi.stubGlobal("URL", Object.assign(URL, { revokeObjectURL: revoke }));
    await act(async () => { await result.current.addStory({ url: "blob:https://app.test/kasim", mediaType: "video" }); });

    const november = projectByMonth(result, 11);
    expect(november.stories).toHaveLength(1);
    expect(november.stories![0].mediaType).toBe("video");
    expect(november.stories![0].mediaUrl).toBe(`${SIGN_BASE}user-1/brand-a/story/new.jpg?token=t`);
    expect(mocks.upload).toHaveBeenCalledWith("blob:https://app.test/kasim", "brand-a/story");
    expect(revoke).toHaveBeenCalledWith("blob:https://app.test/kasim");
    // Ekim etkilenmez.
    expect(projectByMonth(result, 10).stories!.map((story) => story.id)).toEqual(["s-oct"]);

  });

  it("önceki aydan kopyalanan Story ayrı medya alır; Ekim Story silinince Kasım bozulmaz", async () => {
    const { result } = renderHook(() => usePersistedGrid());
    await waitFor(() => expect(result.current.ready).toBe(true));

    act(() => { result.current.createProject("Kasım", 11, 2026, true); });
    await waitFor(() => expect(projectByMonth(result, 11).stories![0].mediaUrl).toContain("copy-1.jpg"));
    const novemberStory = projectByMonth(result, 11).stories![0];
    expect(novemberStory.id).not.toBe("s-oct");
    expect(mocks.duplicate).toHaveBeenCalledWith(`${SIGN_BASE}user-1/brand-a/story/orig.jpg?token=t`, "brand-a/story");

    act(() => { result.current.selectProject("p-oct"); });
    await act(async () => { await result.current.deleteStory("s-oct"); });

    expect(mocks.deletes).toEqual([{ id: "s-oct", user_id: "user-1", project_id: "p-oct" }]);
    expect(mocks.removed).toEqual([["user-1/brand-a/story/orig.jpg"]]);
    expect(projectByMonth(result, 10).stories).toEqual([]);
    expect(projectByMonth(result, 11).stories).toEqual([novemberStory]);
  });

  it("kopya medyası ayrılamadıysa ortak dosya silinmez", async () => {
    mocks.duplicate.mockRejectedValue(new Error("ağ hatası"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { result } = renderHook(() => usePersistedGrid());
    await waitFor(() => expect(result.current.ready).toBe(true));

    act(() => { result.current.createProject("Kasım", 11, 2026, true); });
    await waitFor(() => expect(mocks.duplicate).toHaveBeenCalled());
    act(() => { result.current.selectProject("p-oct"); });
    await act(async () => { await result.current.deleteStory("s-oct"); });

    expect(mocks.deletes).toHaveLength(1);
    expect(mocks.removed).toEqual([]);
    expect(projectByMonth(result, 11).stories![0].mediaUrl).toContain("orig.jpg");
    warn.mockRestore();
  });
});
