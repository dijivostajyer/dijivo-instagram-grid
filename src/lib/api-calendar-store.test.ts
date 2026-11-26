import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ token: "tok-123" as string | null }));

vi.mock("./supabase-browser", () => ({
  getSupabaseBrowserClient: () => ({
    auth: { getSession: async () => ({ data: { session: session.token ? { access_token: session.token } : null } }) },
  }),
}));

import { createApiCalendarStore } from "./api-calendar-store";

const fetchMock = vi.fn();

beforeEach(() => {
  session.token = "tok-123";
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ items: [] }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("istemci takvim deposu: Authorization bearer", () => {
  it("tüm çağrılar bearer token gönderir (list, listAll, create, update, remove)", async () => {
    const store = createApiCalendarStore("/api/calendar");
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ items: [], item: { id: "x" } }), { status: 200 }));
    await store.list("b1", "p1");
    await store.listAll("b1");
    await store.create({ brandId: "b1", projectId: "p1", postId: null, itemType: "post", title: "T", description: "", scheduledAt: "2026-12-01T10:00:00.000Z", status: "draft", checklist: [] });
    await store.update("i1", { title: "Y" }, "b1");
    fetchMock.mockImplementation(async () => new Response(null, { status: 204 }));
    await store.remove("i1", "b1");
    expect(fetchMock).toHaveBeenCalledTimes(5);
    for (const [, init] of fetchMock.mock.calls) {
      expect((init as RequestInit).headers).toMatchObject({ Authorization: "Bearer tok-123", "Content-Type": "application/json" });
    }
  });

  it("oturum yoksa ağ isteği hiç gönderilmez ve Türkçe 401 hatası verilir", async () => {
    session.token = null;
    const store = createApiCalendarStore("/api/calendar");
    await expect(store.list("b1", "p1")).rejects.toThrow("Oturum doğrulanamadı");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sunucu 401/404 döndürürse mesajı yansıtır", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: "Marka veya aylık plan bulunamadı." }), { status: 404 }));
    await expect(createApiCalendarStore().list("b1", "p1")).rejects.toThrow("Marka veya aylık plan bulunamadı.");
  });
});
