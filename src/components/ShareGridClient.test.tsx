// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import ShareGridClient from "./ShareGridClient";
import { computeGrid } from "@/lib/grid";
import type { PublicFeedbackRecord } from "@/lib/share-feedback";
import type { ExistingPost, PlannedPost, Story } from "@/lib/types";

const TOKEN = "11111111-1111-4111-8111-111111111111";
const brand = { id: "shared-brand", name: "Marka", username: "marka" };
const existing: ExistingPost[] = [{ id: "post-1", source: "mevcut", imageUrl: "https://cdn.test/p.jpg", alt: "Gönderi 1", recencyIndex: 0, pinned: false, postType: "post", caption: "Ekim kampanyası" }];
const planned: PlannedPost[] = [{ id: "reel-1", source: "planlanan", imageUrl: "https://cdn.test/r.jpg", alt: "Reel 1", planOrder: 0, postType: "reel" }];
const stories: Story[] = [
  { id: "story-1", mediaType: "image", mediaUrl: "https://cdn.test/s1.jpg", sortOrder: 0, createdAt: "2026-10-01T00:00:00.000Z" },
  { id: "story-2", mediaType: "image", mediaUrl: "https://cdn.test/s2.jpg", sortOrder: 1, createdAt: "2026-10-01T00:00:00.000Z" },
];
const grid = computeGrid(existing, planned);

let requests: Array<Record<string, unknown>>;
let nextResponse: { status: number; body: Record<string, unknown> } | null;

beforeEach(() => {
  requests = [];
  nextResponse = null;
  localStorage.clear();
  let counter = 0;
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    requests.push(body);
    if (nextResponse) return new Response(JSON.stringify(nextResponse.body), { status: nextResponse.status });
    const feedback: PublicFeedbackRecord = {
      id: `fb-${++counter}`,
      targetType: body.targetType as PublicFeedbackRecord["targetType"],
      targetId: (body.targetId as string | null) ?? null,
      action: body.action as PublicFeedbackRecord["action"],
      message: (body.message as string | null) ?? null,
      clientName: body.clientName as string,
      createdAt: new Date(Date.UTC(2026, 9, 14, 9, counter)).toISOString(),
    };
    return new Response(JSON.stringify({ feedback }), { status: 201 });
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderShare(extra: Partial<Parameters<typeof ShareGridClient>[0]> = {}) {
  return render(<ShareGridClient brand={brand} result={grid} stories={stories} token={TOKEN} {...extra} />);
}

function modal() {
  return screen.getByRole("dialog", { name: /Paylaşım gönderisi/ });
}

describe("Paylaşım gönderi modalı geri bildirimi", () => {
  it("O. Post modalında Onayladım / Revize İste görünür; ilk onayda ad sorulur ve kaydedilir", async () => {
    renderShare();
    fireEvent.click(screen.getByRole("button", { name: "Gönderi 1" }));
    const dialog = modal();
    expect(within(dialog).getByText("Post")).toBeTruthy();
    expect(within(dialog).getByText("Yayındaki içerik")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Onayladım" }));
    expect(within(dialog).getByText("Bu içeriği onaylıyor musunuz?")).toBeTruthy();

    // Ad zorunlu.
    fireEvent.click(within(dialog).getByRole("button", { name: "Evet, Onayla" }));
    expect(within(dialog).getByRole("alert").textContent).toBe("Lütfen adınızı yazın.");
    expect(requests).toHaveLength(0);

    fireEvent.change(within(dialog).getByLabelText("Adınız / Marka Yetkilisi"), { target: { value: "Ayşe Yılmaz" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Evet, Onayla" }));
    await waitFor(() => expect(within(dialog).getByRole("status").textContent).toBe("İçerik onaylandı."));
    expect(requests).toEqual([{ targetType: "post", targetId: "post-1", action: "approved", message: null, clientName: "Ayşe Yılmaz" }]);
    expect(within(dialog).getByTestId("feedback-latest").textContent).toContain("Son durum: Onaylandı");
    expect(localStorage.getItem("dijivo-share-client-name")).toBe("Ayşe Yılmaz");
    // Grid hücresinde rozet (modal açıkken hücre "seçili" olarak adlandırılır).
    expect(within(screen.getByRole("button", { name: /^Gönderi 1/ })).getByTestId("feedback-badge").textContent).toBe("Onaylandı");
  });

  it("Reel revizesi mesaj ister; ad tekrar sorulmaz; son durum güncellenir", async () => {
    localStorage.setItem("dijivo-share-client-name", "Ayşe Yılmaz");
    renderShare();
    fireEvent.click(screen.getByRole("button", { name: "Reel 1" }));
    const dialog = modal();
    fireEvent.click(within(dialog).getByRole("button", { name: "Revize İste" }));
    expect(within(dialog).queryByLabelText("Adınız / Marka Yetkilisi")).toBeNull();
    expect(within(dialog).getByText(/Ayşe Yılmaz/)).toBeTruthy();
    const textarea = within(dialog).getByPlaceholderText("Revize talebinizi yazın...") as HTMLTextAreaElement;
    expect(textarea.maxLength).toBe(2000);

    fireEvent.click(within(dialog).getByRole("button", { name: "Revize Talebini Gönder" }));
    expect(within(dialog).getByRole("alert").textContent).toBe("Lütfen revize talebinizi yazın.");
    expect(requests).toHaveLength(0);

    fireEvent.change(textarea, { target: { value: "Müzik daha enerjik olsun." } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Revize Talebini Gönder" }));
    await waitFor(() => expect(within(dialog).getByRole("status").textContent).toBe("Revize talebiniz kaydedildi."));
    expect(requests[0]).toEqual({ targetType: "reel", targetId: "reel-1", action: "revision_requested", message: "Müzik daha enerjik olsun.", clientName: "Ayşe Yılmaz" });
    expect(within(dialog).getByTestId("feedback-latest").textContent).toContain("Son durum: Revize İstendi");
    expect(within(dialog).getByText("Müzik daha enerjik olsun.")).toBeTruthy();
  });

  it("sunucu hatası Türkçe gösterilir ve form açık kalır", async () => {
    localStorage.setItem("dijivo-share-client-name", "Ayşe Yılmaz");
    nextResponse = { status: 404, body: { error: "Paylaşım bağlantısı bulunamadı veya süresi doldu." } };
    renderShare();
    fireEvent.click(screen.getByRole("button", { name: "Gönderi 1" }));
    fireEvent.click(within(modal()).getByRole("button", { name: "Onayladım" }));
    fireEvent.click(within(modal()).getByRole("button", { name: "Evet, Onayla" }));
    await waitFor(() => expect(within(modal()).getByRole("alert").textContent).toBe("Paylaşım bağlantısı bulunamadı veya süresi doldu."));
    expect(within(modal()).getByRole("button", { name: "Evet, Onayla" })).toBeTruthy();
  });

  it("N. sunucudan gelen geçmişten son durum gösterilir", () => {
    renderShare({
      initialFeedback: [
        { id: "a", targetType: "post", targetId: "post-1", action: "revision_requested", message: "Eski", clientName: "Ali", createdAt: "2026-10-13T09:00:00.000Z" },
        { id: "b", targetType: "post", targetId: "post-1", action: "approved", message: null, clientName: "Ayşe", createdAt: "2026-10-14T09:00:00.000Z" },
      ],
    });
    expect(within(screen.getByRole("button", { name: "Gönderi 1" })).getByTestId("feedback-badge").textContent).toBe("Onaylandı");
    expect(within(screen.getByRole("button", { name: "Reel 1" })).queryByTestId("feedback-badge")).toBeNull();
  });
});

describe("Grid geri bildirimi", () => {
  it("D/E. Grid'i Onayladım ve Genel Revize İste grid hedefine gider", async () => {
    localStorage.setItem("dijivo-share-client-name", "Ayşe Yılmaz");
    renderShare();
    const section = screen.getByRole("region", { name: "Grid Hakkında Geri Bildirim" });
    fireEvent.click(within(section).getByRole("button", { name: "Grid'i Onayladım" }));
    expect(within(section).getByText("Gridin tamamını onaylıyor musunuz?")).toBeTruthy();
    fireEvent.click(within(section).getByRole("button", { name: "Evet, Onayla" }));
    await waitFor(() => expect(within(section).getByRole("status").textContent).toBe("Grid onaylandı."));
    fireEvent.click(within(section).getByRole("button", { name: "Genel Revize İste" }));
    fireEvent.change(within(section).getByPlaceholderText("Revize talebinizi yazın..."), { target: { value: "Renk paleti daha sıcak olsun." } });
    fireEvent.click(within(section).getByRole("button", { name: "Revize Talebini Gönder" }));
    await waitFor(() => expect(within(section).getByRole("status").textContent).toBe("Revize talebiniz kaydedildi."));
    expect(requests.map((request) => [request.targetType, request.targetId, request.action])).toEqual([["grid", null, "approved"], ["grid", null, "revision_requested"]]);
  });
});

describe("Story görüntüleyicide geri bildirim", () => {
  it("P. Story için revize gönderilir; yazarken ok tuşları Story değiştirmez", async () => {
    localStorage.setItem("dijivo-share-client-name", "Ayşe Yılmaz");
    renderShare();
    fireEvent.click(screen.getByRole("button", { name: "Marka Story'lerini aç" }));
    const viewer = screen.getByRole("dialog", { name: "Story önizlemesi" });
    const storyImage = () => within(viewer).getByAltText("Story") as HTMLImageElement;
    expect(storyImage().src).toContain("s1.jpg");

    fireEvent.click(within(viewer).getByRole("button", { name: "Revize İste" }));
    const textarea = within(viewer).getByPlaceholderText("Revize talebinizi yazın...");
    textarea.focus();
    fireEvent.keyDown(textarea, { key: "ArrowRight" });
    fireEvent.keyDown(textarea, { key: "Escape" });
    expect(storyImage().src).toContain("s1.jpg");
    expect(screen.getByRole("dialog", { name: "Story önizlemesi" })).toBeTruthy();

    fireEvent.change(textarea, { target: { value: "Yazı okunmuyor." } });
    fireEvent.click(within(viewer).getByRole("button", { name: "Revize Talebini Gönder" }));
    await waitFor(() => expect(within(viewer).getByRole("status").textContent).toBe("Revize talebiniz kaydedildi."));
    expect(requests[0]).toMatchObject({ targetType: "story", targetId: "story-1", action: "revision_requested", message: "Yazı okunmuyor." });

    // Form dışında ok tuşu Story değiştirir; yeni Story'nin kendi paneli olur.
    act(() => { fireEvent.keyDown(window, { key: "ArrowRight" }); });
    expect(storyImage().src).toContain("s2.jpg");
    expect(within(viewer).queryByTestId("feedback-latest")).toBeNull();
  });
});

describe("Q. mobil temel render ve salt-okunur kipi", () => {
  it("butonlar en az 44px yüksekliğinde, iki kolon; modal kaydırılabilir", () => {
    renderShare();
    fireEvent.click(screen.getByRole("button", { name: "Gönderi 1" }));
    const approve = within(modal()).getByRole("button", { name: "Onayladım" });
    expect(approve.className).toContain("h-11");
    expect(approve.parentElement?.className).toContain("grid-cols-2");
    expect(modal().className).toContain("overflow-y-auto");
  });

  it("token yoksa geri bildirim alanları gösterilmez", () => {
    render(<ShareGridClient brand={brand} result={grid} />);
    expect(screen.queryByRole("region", { name: "Grid Hakkında Geri Bildirim" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Gönderi 1" }));
    expect(within(modal()).queryByRole("button", { name: "Onayladım" })).toBeNull();
  });
});
