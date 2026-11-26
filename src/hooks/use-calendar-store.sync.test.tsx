// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const fake = vi.hoisted(() => ({
  list: vi.fn(),
  listAll: vi.fn(),
}));

vi.mock("@/lib/api-calendar-store", () => ({
  createApiCalendarStore: () => ({
    list: fake.list,
    listAll: fake.listAll,
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  }),
}));

import { useCalendarStore } from "./use-calendar-store";

const notFound = () => Object.assign(new Error("Marka veya aylık plan bulunamadı."), { status: 404 });
const item = (id: string, brandId = "b1") => ({
  id, brandId, projectId: "p1", postId: null, itemType: "post", title: id, description: "",
  scheduledAt: "2026-12-15T10:00:00.000Z", status: "planned", checklist: [], createdAt: "x", updatedAt: "x",
});

const sync = { pending: false };

type Props = { brandId: string; projectId: string; tick: number };
function mount(initial: Props = { brandId: "b1", projectId: "p1", tick: 0 }) {
  return renderHook(
    (props: Props) => useCalendarStore({ brandId: props.brandId, projectId: props.projectId, isSyncPending: () => sync.pending, syncSettledTick: props.tick }),
    { initialProps: initial },
  );
}

beforeEach(() => {
  sync.pending = false;
  fake.list.mockReset();
  fake.listAll.mockReset();
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ supabase: true }), { status: 200 })));
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });

describe("takvim hook: bulut eşitlemesine bağlı 404", () => {
  it("normal yükleme: mevcut kayıtlar yüklenir", async () => {
    fake.list.mockResolvedValue([item("i1")]);
    fake.listAll.mockResolvedValue([item("i1"), item("i2")]);
    const { result } = mount();
    await waitFor(() => expect(result.current.loadState).toBe("ready"));
    expect(result.current.items.map((entry) => entry.id)).toEqual(["i1"]);
    expect(result.current.brandItems).toHaveLength(2);
  });

  it("yeni marka: eşitleme sürerken 404 hata değil 'yükleniyor' kalır; eşitleme bitince yeniden yüklenir", async () => {
    sync.pending = true;
    fake.list.mockRejectedValueOnce(notFound()).mockResolvedValue([item("i1")]);
    fake.listAll.mockRejectedValueOnce(notFound()).mockResolvedValue([item("i1")]);
    const { result, rerender } = mount();
    await flush();
    expect(result.current.loadState).toBe("loading"); // geçici: hata ya da boş başarı gösterilmez
    expect(result.current.items).toEqual([]);
    expect(fake.list).toHaveBeenCalledTimes(1);

    sync.pending = false;
    rerender({ brandId: "b1", projectId: "p1", tick: 1 }); // eşitleme tamamlandı
    await waitFor(() => expect(result.current.loadState).toBe("ready"));
    expect(result.current.items.map((entry) => entry.id)).toEqual(["i1"]);
    expect(fake.list).toHaveBeenCalledTimes(2);
  });

  it("eşitleme istek SIRASINDA bittiyse 404 hemen bir kez yeniden denenir", async () => {
    let rejectFirst: (error: unknown) => void = () => undefined;
    fake.list.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectFirst = reject; })).mockResolvedValue([item("i1")]);
    fake.listAll.mockResolvedValue([item("i1")]);
    const { result, rerender } = mount();
    await flush();
    rerender({ brandId: "b1", projectId: "p1", tick: 1 }); // istek uçuştayken eşitleme bitti (pending=false)
    await act(async () => { rejectFirst(notFound()); await Promise.resolve(); });
    await waitFor(() => expect(result.current.loadState).toBe("ready"));
    expect(fake.list).toHaveBeenCalledTimes(2);
  });

  it("GÜVENLİK: eşitleme bitmişken alınan 404 (başkasının/olmayan marka) boş listeye çevrilmez, hata kalır ve yeniden denenmez", async () => {
    sync.pending = false;
    fake.list.mockRejectedValue(notFound());
    fake.listAll.mockRejectedValue(notFound());
    const { result, rerender } = mount();
    await waitFor(() => expect(result.current.loadState).toBe("error"));
    expect(result.current.items).toEqual([]);
    expect(result.current.brandItems).toEqual([]);
    rerender({ brandId: "b1", projectId: "p1", tick: 5 });
    await flush();
    expect(result.current.loadState).toBe("error");
    expect(fake.list).toHaveBeenCalledTimes(1);
  });

  it("kalıcı 404: yeniden deneme sınırlıdır (en fazla 1 + 3 çağrı), sonra görünür hata", async () => {
    fake.list.mockImplementation(async () => { sync.pending = true; throw notFound(); });
    fake.listAll.mockImplementation(async () => { throw notFound(); });
    const { result, rerender } = mount();
    await flush();
    for (let tick = 1; tick <= 8; tick += 1) {
      sync.pending = false;
      rerender({ brandId: "b1", projectId: "p1", tick });
      await flush();
    }
    expect(result.current.loadState).toBe("error");
    expect(fake.list.mock.calls.length).toBeLessThanOrEqual(4);
    const callsAtEnd = fake.list.mock.calls.length;
    rerender({ brandId: "b1", projectId: "p1", tick: 99 });
    await flush();
    expect(fake.list.mock.calls.length).toBe(callsAtEnd); // sonsuz yeniden deneme yok
  });

  it("404 dışındaki hatalar (500) yeniden denenmez", async () => {
    sync.pending = true;
    fake.list.mockRejectedValue(Object.assign(new Error("sunucu"), { status: 500 }));
    fake.listAll.mockRejectedValue(Object.assign(new Error("sunucu"), { status: 500 }));
    const { result } = mount();
    await waitFor(() => expect(result.current.loadState).toBe("error"));
    expect(fake.list).toHaveBeenCalledTimes(1);
  });

  it("hızlı marka değişimi: eski markanın geç gelen yanıtı yeni markanın durumunu ezmez", async () => {
    let resolveOld: (items: unknown[]) => void = () => undefined;
    fake.list.mockImplementation((brandId: string) =>
      brandId === "b1" ? new Promise((resolve) => { resolveOld = resolve; }) : Promise.resolve([item("yeni", "b2")]),
    );
    fake.listAll.mockImplementation((brandId: string) => Promise.resolve(brandId === "b1" ? [item("eski")] : [item("yeni", "b2")]));
    const { result, rerender } = mount();
    await flush();
    rerender({ brandId: "b2", projectId: "p1", tick: 0 });
    await waitFor(() => expect(result.current.loadState).toBe("ready"));
    expect(result.current.items.map((entry) => entry.id)).toEqual(["yeni"]);
    await act(async () => { resolveOld([item("eski")]); await Promise.resolve(); });
    await flush();
    expect(result.current.items.map((entry) => entry.id)).toEqual(["yeni"]);
    expect(result.current.brandItems.map((entry) => entry.id)).toEqual(["yeni"]);
  });
});
