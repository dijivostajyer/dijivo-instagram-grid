// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/lib/supabase-browser", () => ({
  getSupabaseBrowserClient: () => ({ auth: { getSession: async () => ({ data: { session: { access_token: "tok-1" } }, error: null }) } }),
}));
vi.mock("@/lib/share-client", () => ({
  prepareShareInput: async () => ({ cells: [{ id: "c1" }] }),
}));

import { useShareController } from "./SharePanel";

const brand = { id: "b1", name: "Marka", username: "marka" } as never;
const grid = { cells: [{ id: "c1" }] } as never;

const fetchMock = vi.fn();

async function withLink(token = "11111111-1111-4111-8111-111111111111") {
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ token, requestId: "r1" }), { status: 201 }));
  const hook = renderHook(() => useShareController(brand, grid));
  await act(async () => { await hook.result.current.createLink(); });
  await waitFor(() => expect(hook.result.current.token).toBe(token));
  return hook;
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("SharePanel: paylaşım kaldırma (DELETE) yanıt kodları", () => {
  it("200: normal başarılı kaldırma, yerel durum temizlenir", async () => {
    const hook = await withLink();
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    await act(async () => { await hook.result.current.revokeLink(); });
    expect(hook.result.current.token).toBeNull();
    expect(hook.result.current.link).toBeNull();
    expect(hook.result.current.message).toBe("Paylaşım bağlantısı kaldırıldı.");
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toContain("/api/shares/11111111-1111-4111-8111-111111111111");
    expect(init.method).toBe("DELETE");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok-1");
  });

  it("404: zaten kaldırılmış/erişilemez sayılır, yerel durum temizlenir ve yanıltıcı 'kaldırılamadı' hatası çıkmaz", async () => {
    const hook = await withLink();
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: "Paylaşım bağlantısı bulunamadı." }), { status: 404 }));
    await act(async () => { await hook.result.current.revokeLink(); });
    expect(hook.result.current.token).toBeNull();
    expect(hook.result.current.link).toBeNull();
    expect(hook.result.current.message).toBe("Bağlantı bulunamadı. Kaldırılmış, süresi dolmuş veya size ait olmayabilir.");
    expect(hook.result.current.message).not.toContain("kaldırılamadı"); // hata gibi görünmez
    expect(hook.result.current.message).not.toMatch(/zaten kaldırılmış/); // yanlış kesinlik taşımaz
  });

  it.each([401, 403, 500])("%i: başarı SAYILMAZ; bağlantı ve token yerelde korunur, hata mesajı gösterilir", async (status) => {
    const hook = await withLink();
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: "x" }), { status }));
    await act(async () => { await hook.result.current.revokeLink(); });
    expect(hook.result.current.token).toBe("11111111-1111-4111-8111-111111111111");
    expect(hook.result.current.link).not.toBeNull();
    expect(hook.result.current.message).toBe("Paylaşım bağlantısı kaldırılamadı.");
  });

  it("aynı denetleyicide bağlantı yenilenmişse 404 yalnızca GÜNCEL token için DELETE gönderir ve onu temizler; eski token'a istek gitmez", async () => {
    const first = "11111111-1111-4111-8111-111111111111";
    const second = "22222222-2222-4222-8222-222222222222";
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ token: first, requestId: "r1" }), { status: 201 }));
    const hook = renderHook(() => useShareController(brand, grid));
    await act(async () => { await hook.result.current.createLink(); });
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ token: second, requestId: "r2" }), { status: 201 }));
    await act(async () => { await hook.result.current.createLink(); });
    await waitFor(() => expect(hook.result.current.token).toBe(second));

    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 404 }));
    await act(async () => { await hook.result.current.revokeLink(); });

    const deletes = fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "DELETE");
    expect(deletes).toHaveLength(1);
    expect(String(deletes[0][0])).toContain(`/api/shares/${second}`);
    expect(deletes.some(([url]) => String(url).includes(first))).toBe(false);
    expect(hook.result.current.token).toBeNull();
    expect(hook.result.current.link).toBeNull();
  });

  it("başarısız (500) iptal denemesi token'ı korur; sonraki başarılı iptal yine yalnızca aynı token'ı hedefler", async () => {
    const hook = await withLink("33333333-3333-4333-8333-333333333333");
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 500 }));
    await act(async () => { await hook.result.current.revokeLink(); });
    expect(hook.result.current.token).toBe("33333333-3333-4333-8333-333333333333");
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    await act(async () => { await hook.result.current.revokeLink(); });
    const deletes = fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "DELETE");
    expect(deletes).toHaveLength(2);
    for (const [url] of deletes) expect(String(url)).toContain("/api/shares/33333333-3333-4333-8333-333333333333");
    expect(hook.result.current.token).toBeNull();
  });

  it("ağ hatasında başarı sayılmaz ve token korunur", async () => {
    const hook = await withLink();
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await act(async () => { await hook.result.current.revokeLink(); });
    expect(hook.result.current.token).toBe("11111111-1111-4111-8111-111111111111");
  });
});
