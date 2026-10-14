// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import FeedbackCenter from "./FeedbackCenter";
import type { FeedbackCenterRecord } from "@/lib/feedback-center";
import type { FeedbackCenterSource } from "@/lib/feedback-center-client";
import {
  InMemoryFeedbackCenterDriver,
  getFeedbackCenterDetail,
  handleMarkRead,
  handleWorkflowUpdate,
  listFeedbackCenter,
} from "@/lib/feedback-center-server";
import type { GridProject } from "@/lib/storage";
import type { Brand } from "@/lib/types";

const ME = "00000000-0000-4000-8000-000000000001";
const T1 = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-10-14T12:00:00.000Z");

const brands: Brand[] = [
  { id: "brand-a", name: "Dijivo Kafe", username: "dijivokafe", profileImageUrl: "https://cdn.test/a.jpg" },
  { id: "brand-b", name: "Moda Butik", username: "modabutik" },
];
const project = (id: string, brandId: string, month: number): GridProject => ({
  id, name: id, month, year: 2026, createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z",
  brandId, brand: brands.find((brand) => brand.id === brandId)!, existingPosts: [], plannedPosts: [],
});
const projects = [project("p-a-oct", "brand-a", 10), project("p-a-sep", "brand-a", 9), project("p-b-oct", "brand-b", 10)];

const payload = {
  version: 1, token: T1, createdAt: "2026-10-10T09:00:00.000Z",
  brand: { name: "Dijivo Kafe", username: "dijivokafe" },
  cells: [
    { id: "post-1", source: "mevcut", imageUrl: `storage:shares/${T1}/post.jpg`, position: 0, row: 0, column: 0, pinned: false, postType: "post", caption: "Ekim kampanyası başlıyor" },
    { id: "reel-1", source: "planlanan", imageUrl: `storage:shares/${T1}/reel.jpg`, position: 1, row: 0, column: 1, pinned: false, postType: "reel" },
  ],
  stories: [{ id: "story-1", mediaType: "image", mediaUrl: `storage:shares/${T1}/story.jpg`, sortOrder: 0 }],
};

let seq = 0;
const rec = (overrides: Partial<FeedbackCenterRecord>): FeedbackCenterRecord & { userId: string } => {
  seq += 1;
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`, userId: ME, shareToken: T1, brandId: "brand-a", projectId: "p-a-oct",
    targetType: "post", targetId: "post-1", action: "approved", message: null, clientName: "Ayşe Yılmaz",
    createdAt: new Date(Date.UTC(2026, 9, 14, 9, seq)).toISOString(), workflowStatus: "new", workflowUpdatedAt: null, readAt: null, ...overrides,
  };
};

let driver: InMemoryFeedbackCenterDriver;
let source: FeedbackCenterSource & { calls: { list: ReturnType<typeof vi.fn> } };

function makeSource(records: Array<FeedbackCenterRecord & { userId: string }>) {
  driver = new InMemoryFeedbackCenterDriver(records, new Map([[T1, { token: T1, payload, createdAt: "2026-10-10T09:00:00.000Z", expiresAt: "2026-11-09T00:00:00.000Z", revokedAt: null }]]), () => NOW);
  const list = vi.fn((query) => listFeedbackCenter(ME, query, driver, NOW));
  source = {
    calls: { list },
    list,
    detail: async (id) => (await getFeedbackCenterDetail(ME, id, driver, NOW))!,
    setWorkflow: async (id, status) => (await handleWorkflowUpdate(ME, id, { workflowStatus: status }, driver)).body.record as FeedbackCenterRecord,
    markRead: async (ids) => (await handleMarkRead(ME, { ids }, driver)).body as { ids: string[]; unreadCount: number },
  };
  return source;
}

let onOpenTarget: ReturnType<typeof vi.fn>;
function renderCenter(records: Array<FeedbackCenterRecord & { userId: string }>) {
  onOpenTarget = vi.fn();
  return render(<FeedbackCenter source={makeSource(records)} brands={brands} projects={projects} onOpenTarget={onOpenTarget} />);
}

const cards = () => screen.queryAllByTestId("feedback-card");

beforeEach(() => {
  seq = 0;
});
afterEach(cleanup);

describe("Geri Dönüşler listesi", () => {
  it("U. hiç geri dönüş yoksa boş durum", async () => {
    renderCenter([]);
    expect(await screen.findByTestId("feedback-empty")).toBeTruthy();
    expect(screen.getByText("Henüz geri dönüş yok.")).toBeTruthy();
    expect(screen.getByText("Paylaşım bağlantılarından gelen onay ve revize talepleri burada görüntülenir.")).toBeTruthy();
  });

  it("C/D/E/F/G/H. Post 3:4, Reel 2:3, Story 9:16, grid ikon; onay ve revize mesajı; marka, ay, müşteri, tarih", async () => {
    renderCenter([
      rec({ targetType: "post", targetId: "post-1", action: "approved" }),
      rec({ targetType: "reel", targetId: "reel-1", action: "revision_requested", message: "Müzik daha enerjik olsun." }),
      rec({ targetType: "story", targetId: "story-1", action: "approved" }),
      rec({ targetType: "grid", targetId: null, action: "revision_requested", message: "Renk paleti sıcak olsun.", projectId: "p-b-oct", brandId: "brand-b", clientName: "Mehmet Kaya" }),
    ]);
    await waitFor(() => expect(cards()).toHaveLength(4));
    const [grid, story, reel, post] = cards(); // en yeni üstte
    expect(within(post).getByRole("img").parentElement?.className).toContain("aspect-[3/4]");
    // Flex kartı küçük resmi uzatıp oranı bozmasın (tarayıcıda ölçülen hata).
    expect(within(post).getByRole("img").parentElement?.className).toContain("self-start");
    expect(post.getAttribute("aria-label")).toBe("Dijivo Kafe, Ekim 2026, Post, Onaylandı, Yeni, Ayşe Yılmaz, okunmamış");
    expect(within(reel).getByRole("img").parentElement?.className).toContain("aspect-[2/3]");
    expect(within(story).getByRole("img", { name: "Story önizlemesi" }).parentElement?.className).toContain("aspect-[9/16]");
    expect(within(grid).getByLabelText("Tüm grid").className).toContain("aspect-square");
    expect(within(post).getByText("Post")).toBeTruthy();
    expect(within(post).getByText("Onaylandı")).toBeTruthy();
    expect(within(post).getByText("Müşteri onay verdi.")).toBeTruthy();
    expect(within(reel).getByText("Revize İstendi")).toBeTruthy();
    expect(within(reel).getByText("Müzik daha enerjik olsun.")).toBeTruthy();
    expect(within(grid).getByText("Tüm Grid")).toBeTruthy();
    expect(within(grid).getByText("Moda Butik")).toBeTruthy();
    expect(within(grid).getByText("· Ekim 2026")).toBeTruthy();
    expect(within(grid).getByText(/Mehmet Kaya/)).toBeTruthy();
    expect(within(post).getByText(/14 Ekim 2026, \d{2}:\d{2}/)).toBeTruthy();
    expect(within(post).getByLabelText("Okunmamış")).toBeTruthy();
    expect(screen.getByTestId("unread-count").textContent).toBe("4 okunmamış");
  });

  it("T. snapshot'ta bulunmayan hedef yedek önizleme gösterir", async () => {
    renderCenter([rec({ targetId: "silinmis" })]);
    await waitFor(() => expect(cards()).toHaveLength(1));
    expect(within(cards()[0]).getByTestId("preview-fallback")).toBeTruthy();
    fireEvent.click(cards()[0]);
    const detail = await screen.findByTestId("feedback-detail");
    await waitFor(() => expect(within(detail).getByText("İçerik önizlemesi kullanılamıyor.")).toBeTruthy());
  });

  it("K/L/M/N/O. filtreler ve arama sunucu sorgusuna doğru yansır", async () => {
    renderCenter([
      rec({ brandId: "brand-a", projectId: "p-a-oct" }),
      rec({ brandId: "brand-a", projectId: "p-a-sep", targetType: "reel", targetId: "reel-1", action: "revision_requested", message: "Kapak değişsin" }),
      rec({ brandId: "brand-b", projectId: "p-b-oct", targetType: "story", targetId: "story-1", action: "revision_requested", message: "Yazı okunmuyor", clientName: "Mehmet Kaya" }),
    ]);
    await waitFor(() => expect(cards()).toHaveLength(3));
    const lastQuery = () => source.calls.list.mock.calls.at(-1)![0];

    fireEvent.change(screen.getByLabelText("Marka"), { target: { value: "brand-a" } });
    await waitFor(() => expect(cards()).toHaveLength(2));
    expect(lastQuery()).toMatchObject({ brandId: "brand-a" });

    fireEvent.change(screen.getByLabelText("Ay"), { target: { value: "2026-09" } });
    await waitFor(() => expect(cards()).toHaveLength(1));
    expect(lastQuery().projectIds).toEqual(["p-a-sep"]);

    fireEvent.click(screen.getByRole("button", { name: "Filtreleri temizle" }));
    await waitFor(() => expect(cards()).toHaveLength(3));

    fireEvent.change(screen.getByLabelText("İçerik tipi"), { target: { value: "story" } });
    await waitFor(() => expect(cards()).toHaveLength(1));
    fireEvent.change(screen.getByLabelText("İçerik tipi"), { target: { value: "" } });

    fireEvent.click(screen.getByRole("button", { name: "Yalnız revizeler" }));
    await waitFor(() => expect(cards()).toHaveLength(2));
    expect(lastQuery()).toMatchObject({ action: "revision_requested" });
    fireEvent.click(screen.getByRole("button", { name: "Yalnız revizeler" }));

    vi.useFakeTimers();
    fireEvent.change(screen.getByPlaceholderText("Marka, @kullanıcı adı, müşteri veya mesaj ara"), { target: { value: "@modabutik" } });
    await act(async () => { vi.advanceTimersByTime(350); });
    vi.useRealTimers();
    await waitFor(() => expect(cards()).toHaveLength(1));
    expect(lastQuery()).toMatchObject({ q: "@modabutik", qBrandIds: ["brand-b"] });
  });

  it("N. iş akışı filtresi", async () => {
    renderCenter([rec({}), rec({ workflowStatus: "revision_done", action: "revision_requested", message: "x" })]);
    await waitFor(() => expect(cards()).toHaveLength(2));
    fireEvent.change(screen.getByLabelText("İş akışı durumu"), { target: { value: "revision_done" } });
    await waitFor(() => expect(cards()).toHaveLength(1));
    expect(within(cards()[0]).getByText("Revize Tamamlandı")).toBeTruthy();
  });

  it("filtreye uyan kayıt yoksa ayrı boş durum ve temizleme", async () => {
    renderCenter([rec({})]);
    await waitFor(() => expect(cards()).toHaveLength(1));
    fireEvent.change(screen.getByLabelText("İçerik tipi"), { target: { value: "story" } });
    expect(await screen.findByText("Filtrelere uyan geri dönüş yok.")).toBeTruthy();
    expect(screen.queryByTestId("feedback-empty")).toBeNull();
  });
});

describe("Detay, geçmiş ve iş akışı", () => {
  it("I/P. detay geçmişi kronolojik; liste açılınca değil detay açılınca okundu olur", async () => {
    const first = rec({ action: "approved" });
    const second = rec({ action: "revision_requested", message: "Başlığı değiştirelim." });
    const other = rec({ targetType: "reel", targetId: "reel-1" });
    renderCenter([first, second, other]);
    await waitFor(() => expect(cards()).toHaveLength(3));
    expect(driver.records.every((record) => record.readAt === null)).toBe(true); // liste okundu yapmaz

    fireEvent.click(cards()[1]); // second
    const detail = await screen.findByTestId("feedback-detail");
    await waitFor(() => expect(within(detail).getByTestId("feedback-timeline").children).toHaveLength(2));
    const entries = within(detail).getByTestId("feedback-timeline").children;
    expect(entries[0].textContent).toContain("Onaylandı");
    expect(entries[1].textContent).toContain("Başlığı değiştirelim.");
    expect(within(detail).getByTestId("feedback-message").textContent).toBe("Başlığı değiştirelim.");
    expect(within(detail).getByText("Ekim kampanyası başlıyor")).toBeTruthy(); // caption
    expect(within(detail).getByText(/Aktif/)).toBeTruthy();

    await waitFor(() => expect(screen.getByTestId("unread-count").textContent).toBe("1 okunmamış"));
    expect(driver.records.find((record) => record.id === other.id)?.readAt).toBeNull();
    expect(within(cards()[1]).queryByLabelText("Okunmamış")).toBeNull();
    expect(within(cards()[0]).getByLabelText("Okunmamış")).toBeTruthy();
  });

  it("R/Q. Revize Tamamlandı: iç durum değişir, müşteri eylemi kalır, geçmişe ekip olayı eklenir", async () => {
    const revision = rec({ action: "revision_requested", message: "Logo büyüsün." });
    renderCenter([revision]);
    await waitFor(() => expect(cards()).toHaveLength(1));
    fireEvent.click(cards()[0]);
    const detail = await screen.findByTestId("feedback-detail");
    fireEvent.click(await within(detail).findByRole("button", { name: "Revize Tamamlandı" }));
    await waitFor(() => expect(within(detail).getByTestId("feedback-timeline").textContent).toContain("Ekip — Revize Tamamlandı"));
    expect(within(cards()[0]).getByText("Revize Tamamlandı")).toBeTruthy();
    expect(within(cards()[0]).getByText("Revize İstendi")).toBeTruthy();
    expect(within(detail).queryByRole("button", { name: "Revize Tamamlandı" })).toBeNull();
    expect(driver.records[0]).toMatchObject({ action: "revision_requested", message: "Logo büyüsün.", workflowStatus: "revision_done" });

    fireEvent.change(within(detail).getByLabelText("Durumu değiştir"), { target: { value: "closed" } });
    await waitFor(() => expect(driver.records[0].workflowStatus).toBe("closed"));
    await waitFor(() => expect((within(detail).getByLabelText("Durumu değiştir") as HTMLSelectElement).value).toBe("closed"));
    expect(within(cards()[0]).getByText("Kapatıldı")).toBeTruthy();
  });

  it("S. Projeye Git hedef bilgisiyle çağrılır; plan yoksa devre dışı", async () => {
    renderCenter([rec({ targetType: "reel", targetId: "reel-1", projectId: "p-a-oct" }), rec({ projectId: "silinmis-plan" })]);
    await waitFor(() => expect(cards()).toHaveLength(2));
    fireEvent.click(cards()[1]);
    let detail = await screen.findByTestId("feedback-detail");
    fireEvent.click(within(detail).getByRole("button", { name: "Projeye Git" }));
    expect(onOpenTarget).toHaveBeenCalledWith({ brandId: "brand-a", projectId: "p-a-oct", targetType: "reel", targetId: "reel-1" });

    fireEvent.click(cards()[0]);
    detail = await screen.findByTestId("feedback-detail");
    await waitFor(() => expect((within(detail).getByRole("button", { name: "Projeye Git" }) as HTMLButtonElement).disabled).toBe(true));
    expect(within(detail).getByText("Bu geri dönüşün aylık planı çalışma alanında bulunamadı.")).toBeTruthy();
  });

  it("V. mobil: kartlar taşmaz, detay tam ekran katman olarak açılır ve kapanır", async () => {
    renderCenter([rec({ message: "çok uzun ".repeat(60), action: "revision_requested" })]);
    await waitFor(() => expect(cards()).toHaveLength(1));
    expect(cards()[0].className).toContain("min-w-0");
    expect(within(cards()[0]).getByText(/çok uzun/).className).toContain("break-words");
    const aside = screen.getByRole("complementary", { name: "Geri dönüş detayı" });
    expect(aside.className).toContain("hidden");
    fireEvent.click(cards()[0]);
    await screen.findByTestId("feedback-detail");
    expect(aside.className).toContain("fixed inset-0");
    expect(aside.className).toContain("overflow-y-auto");
    fireEvent.click(screen.getByRole("button", { name: "Detayı kapat" }));
    expect(screen.queryByTestId("feedback-detail")).toBeNull();
  });

  it("daha fazla yükle: sonraki sayfa eklenir, tekrar eden kayıt olmaz", async () => {
    renderCenter(Array.from({ length: 55 }, () => rec({})));
    await waitFor(() => expect(cards()).toHaveLength(50));
    fireEvent.click(screen.getByRole("button", { name: "Daha fazla göster" }));
    await waitFor(() => expect(cards()).toHaveLength(55));
    expect(screen.queryByRole("button", { name: "Daha fazla göster" })).toBeNull();
  });
});
