// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import AppSidebar from "./AppSidebar";
import NotificationBell from "./NotificationBell";
import type { FeedbackNotificationItem } from "@/lib/feedback-notifications";
import type { GridProject } from "@/lib/storage";
import type { Brand } from "@/lib/types";

afterEach(cleanup);

const brands: Brand[] = [{ id: "b-moda", name: "Moda Butik", username: "modabutik" }, { id: "b-abc", name: "ABC Marka", username: "abc" }];
const projects: GridProject[] = [{
  id: "p-oct", name: "Ekim", month: 10, year: 2026, createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z",
  brandId: "b-moda", brand: brands[0], existingPosts: [], plannedPosts: [],
}];
const item = (overrides: Partial<FeedbackNotificationItem>): FeedbackNotificationItem => ({
  id: "n", brandId: "b-moda", projectId: "p-oct", targetType: "reel", targetId: "r", action: "revision_requested",
  messagePreview: null, clientName: "Ayşe Yılmaz", createdAt: "2026-10-14T10:42:00.000Z", readAt: null, ...overrides,
});
const items = [
  item({ id: "1", targetType: "reel", action: "revision_requested", messagePreview: "Müzik değişsin." }),
  item({ id: "2", brandId: "b-abc", projectId: null, targetType: "story", action: "approved", clientName: "Mehmet", createdAt: "2026-10-14T09:00:00.000Z" }),
  item({ id: "3", brandId: "b-moda", projectId: null, targetType: "grid", action: "revision_requested", readAt: "2026-10-14T11:00:00.000Z", createdAt: "2026-10-13T09:00:00.000Z" }),
];

function renderBell(overrides: Partial<Parameters<typeof NotificationBell>[0]> = {}) {
  const props = {
    count: 2, items, loaded: true, error: null, brands, projects,
    onOpenItem: vi.fn(), onViewAll: vi.fn(), onMarkAllRead: vi.fn(async () => undefined),
    ...overrides,
  };
  render(<NotificationBell {...props} />);
  return props;
}

describe("Bildirim zili", () => {
  it("C. 0 okunmamışta rozet yok", () => {
    renderBell({ count: 0 });
    expect(screen.queryByTestId("notification-badge")).toBeNull();
    expect(screen.getByRole("button", { name: "Bildirimler" })).toBeTruthy();
  });

  it("D/E. 5 → '5', 120 → '99+'", () => {
    renderBell({ count: 5 });
    expect(screen.getByTestId("notification-badge").textContent).toBe("5");
    expect(screen.getByRole("button", { name: "Bildirimler, 5 okunmamış" })).toBeTruthy();
    cleanup();
    renderBell({ count: 120 });
    expect(screen.getByTestId("notification-badge").textContent).toBe("99+");
  });

  it("F/G-J. panel en yeni üstte, doğal Türkçe metin, mesaj özeti, müşteri, tarih ve okunmamış işareti", () => {
    renderBell();
    fireEvent.click(screen.getByRole("button", { name: /Bildirimler/ }));
    const panel = screen.getByRole("dialog", { name: "Bildirimler" });
    const rows = within(panel).getAllByTestId("notification-item");
    expect(rows.map((row) => row.textContent?.split("“")[0].split("Ayşe")[0].split("Mehmet")[0].replace(" (okunmamış)", "").trim())).toEqual([
      "Moda Butik, Ekim 2026 planındaki Reel için revize istedi.",
      "ABC Marka, bir Story'yi onayladı.",
      "Moda Butik, grid için genel revize istedi.",
    ]);
    expect(within(rows[0]).getByText("“Müzik değişsin.”")).toBeTruthy();
    expect(within(rows[0]).getByText(/Ayşe Yılmaz/)).toBeTruthy();
    expect(within(rows[0]).getByText(/14 Ekim 2026, \d{2}:\d{2}/)).toBeTruthy();
    expect(within(rows[0]).getByText("(okunmamış)")).toBeTruthy();
    expect(within(rows[2]).queryByText("(okunmamış)")).toBeNull();
  });

  it("K. bildirime tıklama yalnız o kaydı açtırır ve paneli kapatır", () => {
    const props = renderBell();
    fireEvent.click(screen.getByRole("button", { name: /Bildirimler/ }));
    fireEvent.click(within(screen.getByRole("dialog")).getAllByTestId("notification-item")[1]);
    expect(props.onOpenItem).toHaveBeenCalledWith("2");
    expect(props.onOpenItem).toHaveBeenCalledTimes(1);
    expect(props.onMarkAllRead).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("N. Tümünü Okundu Yap yalnız tıklanınca; 0 okunmamışta devre dışı", async () => {
    const props = renderBell();
    fireEvent.click(screen.getByRole("button", { name: /Bildirimler/ }));
    expect(props.onMarkAllRead).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Tümünü Okundu Yap" })); });
    expect(props.onMarkAllRead).toHaveBeenCalledTimes(1);
    cleanup();
    renderBell({ count: 0 });
    fireEvent.click(screen.getByRole("button", { name: "Bildirimler" }));
    expect((screen.getByRole("button", { name: "Tümünü Okundu Yap" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("Tüm Geri Dönüşleri Gör, ESC ve dışarı tıklama", () => {
    const props = renderBell();
    fireEvent.click(screen.getByRole("button", { name: /Bildirimler/ }));
    fireEvent.click(screen.getByRole("button", { name: "Tüm Geri Dönüşleri Gör" }));
    expect(props.onViewAll).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Bildirimler/ }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Bildirimler/ }));
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("boş, yükleniyor ve hata durumları", () => {
    renderBell({ items: [], count: 0 });
    fireEvent.click(screen.getByRole("button", { name: "Bildirimler" }));
    expect(screen.getByText("Henüz bildirim yok.")).toBeTruthy();
    cleanup();
    renderBell({ items: [], count: 0, loaded: false, error: "x" });
    fireEvent.click(screen.getByRole("button", { name: "Bildirimler" }));
    expect(screen.getByRole("alert").textContent).toBe("Bildirimler yüklenemedi.");
  });

  it("Q. mobil: panel ekran genişliğinde sabit (taşmaz); masaüstünde zilin altında", () => {
    renderBell();
    fireEvent.click(screen.getByRole("button", { name: /Bildirimler/ }));
    const panel = screen.getByRole("dialog", { name: "Bildirimler" });
    expect(panel.className).toContain("fixed inset-x-3");
    expect(panel.className).toContain("sm:absolute");
    expect(panel.className).toContain("sm:w-96");
    expect(within(panel).getAllByTestId("notification-item")[0].className).toContain("min-w-0");
  });
});

describe("Sidebar rozeti (masaüstü ve mobil menü aynı bileşen)", () => {
  it("C/D/E. 0 → yok, 3 → 3, 120 → 99+", async () => {
    const { rerender } = render(<AppSidebar view="overview" onNavigate={() => undefined} badges={{ feedback: 0 }} />);
    expect(screen.queryByTestId("nav-badge-feedback")).toBeNull();
    rerender(<AppSidebar view="overview" onNavigate={() => undefined} badges={{ feedback: 3 }} />);
    await waitFor(() => expect(screen.getByTestId("nav-badge-feedback").textContent).toBe("3 okunmamış"));
    expect(screen.getByRole("button", { name: /Geri Dönüşler/ }).textContent).toContain("3");
    rerender(<AppSidebar view="overview" onNavigate={() => undefined} badges={{ feedback: 120 }} />);
    expect(screen.getByTestId("nav-badge-feedback").textContent).toBe("99+ okunmamış");
  });
});
