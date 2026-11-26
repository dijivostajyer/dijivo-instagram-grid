// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

const validators = vi.hoisted(() => ({
  loadVideoFile: vi.fn(),
  loadCoverFile: vi.fn(),
  createVideoPoster: vi.fn(),
  getMediaSizeAdvisory: vi.fn(),
  safeRevokeObjectUrl: vi.fn(),
}));
vi.mock("@/lib/validators", () => validators);

import ReelDraftEditor from "./ReelDraftEditor";

function inputs() {
  const all = [...document.querySelectorAll<HTMLInputElement>('input[type="file"]')];
  return {
    video: all.find((input) => input.accept === "video/mp4,video/webm")!,
    cover: all.find((input) => input.accept.includes("image/"))!,
  };
}

async function pick(input: HTMLInputElement, name: string, type: string) {
  await act(async () => {
    fireEvent.change(input, { target: { files: [new File(["x"], name, { type })] } });
  });
}

beforeEach(() => {
  validators.loadVideoFile.mockImplementation(async (file: File) => ({ url: `blob:${file.name}`, width: 1080, height: 1920 }));
  validators.loadCoverFile.mockImplementation(async (file: File) => ({ url: `blob:${file.name}`, alt: file.name, width: 1080, height: 1920 }));
  validators.createVideoPoster.mockImplementation(async (url: string) => ({ url: `${url}#poster`, width: 1080, height: 1920 }));
  validators.getMediaSizeAdvisory.mockReturnValue(null);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ReelDraftEditor", () => {
  it("video seçilince taslak önizlemesi ve kaldır/değiştir butonları çıkar", async () => {
    render(<ReelDraftEditor hint="ipucu" onAdd={vi.fn()} />);
    expect(screen.queryByLabelText("Reel video önizlemesi (taslak)")).toBeNull();
    await pick(inputs().video, "reel.mp4", "video/mp4");
    expect(screen.getByLabelText("Reel video önizlemesi (taslak)")).toBeDefined();
    expect(screen.getByRole("button", { name: "Videoyu değiştir" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Videoyu kaldır" })).toBeDefined();
  });

  it("videoyu kaldırınca önizleme gider, URL iptal edilir ve Reel ekle pasifleşir", async () => {
    render(<ReelDraftEditor hint="ipucu" onAdd={vi.fn()} />);
    await pick(inputs().video, "reel.mp4", "video/mp4");
    fireEvent.click(screen.getByRole("button", { name: "Videoyu kaldır" }));
    expect(screen.queryByLabelText("Reel video önizlemesi (taslak)")).toBeNull();
    expect(validators.safeRevokeObjectUrl).toHaveBeenCalledWith("blob:reel.mp4");
    expect((screen.getByRole("button", { name: "Reel ekle" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("video değiştirilince eski taslak URL'i iptal edilir", async () => {
    render(<ReelDraftEditor hint="ipucu" onAdd={vi.fn()} />);
    await pick(inputs().video, "a.mp4", "video/mp4");
    await pick(inputs().video, "b.mp4", "video/mp4");
    expect(validators.safeRevokeObjectUrl).toHaveBeenCalledWith("blob:a.mp4");
    expect(validators.safeRevokeObjectUrl).not.toHaveBeenCalledWith("blob:b.mp4");
  });

  it("kapak ayrı kalır: kapak yüklenince poster üretilmez ve ikisi karışmaz", async () => {
    const onAdd = vi.fn();
    render(<ReelDraftEditor hint="ipucu" onAdd={onAdd} />);
    await pick(inputs().video, "reel.mp4", "video/mp4");
    await pick(inputs().cover, "kapak.png", "image/png");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Reel ekle" }));
    });
    expect(validators.createVideoPoster).not.toHaveBeenCalled();
    expect(onAdd).toHaveBeenCalledWith({
      videoUrl: "blob:reel.mp4",
      videoName: "reel.mp4",
      coverUrl: "blob:kapak.png",
      coverAlt: "kapak.png",
      posterUrl: undefined,
    });
  });

  it("kapak yoksa videodan ayrı bir poster üretilir (kapak olarak sayılmaz)", async () => {
    const onAdd = vi.fn();
    render(<ReelDraftEditor hint="ipucu" onAdd={onAdd} />);
    await pick(inputs().video, "reel.mp4", "video/mp4");
    expect(screen.getByText(/ilk karesinden otomatik/)).toBeDefined();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Reel ekle" }));
    });
    const draft = onAdd.mock.calls[0][0];
    expect(draft.posterUrl).toBe("blob:reel.mp4#poster");
    expect(draft.coverUrl).toBeUndefined();
    // Teslim edilen URL'ler üst bileşene aittir; taslak bunları iptal etmez.
    expect(validators.safeRevokeObjectUrl).not.toHaveBeenCalledWith("blob:reel.mp4");
    expect(validators.safeRevokeObjectUrl).not.toHaveBeenCalledWith("blob:reel.mp4#poster");
  });

  it("poster üretilemezse Reel yine eklenir ve kapak önerisi gösterilir", async () => {
    validators.createVideoPoster.mockResolvedValue(null);
    const onAdd = vi.fn();
    render(<ReelDraftEditor hint="ipucu" onAdd={onAdd} />);
    await pick(inputs().video, "reel.mp4", "video/mp4");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Reel ekle" }));
    });
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd.mock.calls[0][0].posterUrl).toBeUndefined();
    expect(screen.getByRole("status").textContent).toContain("kapak yüklemeniz önerilir");
  });

  it("ekleme başarısız olursa anlaşılır hata gösterilir ve taslak korunur", async () => {
    const onAdd = vi.fn().mockRejectedValue(new Error("Medya yükleme bağlantısı oluşturulamadı"));
    render(<ReelDraftEditor hint="ipucu" onAdd={onAdd} />);
    await pick(inputs().video, "reel.mp4", "video/mp4");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Reel ekle" }));
    });
    expect(screen.getByRole("alert").textContent).toContain("Medya yükleme bağlantısı oluşturulamadı");
    expect(screen.getByLabelText("Reel video önizlemesi (taslak)")).toBeDefined();
    // Üretilen ama kullanılmayan poster serbest bırakılır.
    expect(validators.safeRevokeObjectUrl).toHaveBeenCalledWith("blob:reel.mp4#poster");
  });

  it("geçersiz video hatası gösterilir ve taslak oluşmaz", async () => {
    validators.loadVideoFile.mockRejectedValue(new Error("MOV biçimi desteklenmiyor. Lütfen videoyu MP4 (H.264) biçimine dönüştürüp yeniden yükleyin."));
    render(<ReelDraftEditor hint="ipucu" onAdd={vi.fn()} />);
    await pick(inputs().video, "klip.mov", "video/quicktime");
    expect(screen.getByRole("alert").textContent).toContain("MP4");
    expect(screen.queryByLabelText("Reel video önizlemesi (taslak)")).toBeNull();
  });

  it("R6 uyarıları video ve kapak yüklemesinde gösterilir; yükleme engellenmez", async () => {
    validators.getMediaSizeAdvisory.mockReturnValue("540×960 px çözünürlük düşük; Reel için önerilen boyut 1080 × 1920 px (9:16).");
    render(<ReelDraftEditor hint="ipucu" onAdd={vi.fn()} />);
    await pick(inputs().video, "reel.mp4", "video/mp4");
    expect(screen.getByRole("status").textContent).toContain("çözünürlük düşük");
    expect(screen.getByLabelText("Reel video önizlemesi (taslak)")).toBeDefined();
    await pick(inputs().cover, "kapak.png", "image/png");
    expect(screen.getByRole("status").textContent).toContain("Kapak boyut önerisi");
    expect(screen.getByAltText("Reel kapak önizlemesi")).toBeDefined();
  });

  it("kapak kaldırılır; video taslağı etkilenmez", async () => {
    render(<ReelDraftEditor hint="ipucu" onAdd={vi.fn()} />);
    await pick(inputs().video, "reel.mp4", "video/mp4");
    await pick(inputs().cover, "kapak.png", "image/png");
    fireEvent.click(screen.getByRole("button", { name: "Kapağı kaldır" }));
    expect(screen.queryByAltText("Reel kapak önizlemesi")).toBeNull();
    expect(screen.getByLabelText("Reel video önizlemesi (taslak)")).toBeDefined();
    expect(validators.safeRevokeObjectUrl).toHaveBeenCalledWith("blob:kapak.png");
  });

  it("eklenmeden kapanırsa taslak URL'leri iptal edilir (bellek sızıntısı yok)", async () => {
    const { unmount } = render(<ReelDraftEditor hint="ipucu" onAdd={vi.fn()} />);
    await pick(inputs().video, "reel.mp4", "video/mp4");
    await pick(inputs().cover, "kapak.png", "image/png");
    unmount();
    expect(validators.safeRevokeObjectUrl).toHaveBeenCalledWith("blob:reel.mp4");
    expect(validators.safeRevokeObjectUrl).toHaveBeenCalledWith("blob:kapak.png");
  });
});
