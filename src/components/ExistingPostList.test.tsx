// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { act } from "react";

import { addExistingPost } from "@/lib/post-ops";
import type { ExistingPost } from "@/lib/types";

// Gerçek görsel decode'ı jsdom'da çalışmaz; doğrulama
// katmanı taklidi edilir (tür/ boyut kontrolü bileşenin
// iş akışını değiştirmez).
vi.mock("@/lib/validators", () => ({
  MAX_VIDEO_BYTES: 100 * 1024 * 1024,
  loadImageFile: vi.fn(async (file: File) => {
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      throw new Error("Desteklenmeyen dosya türü. Lütfen JPG, PNG veya WebP biçiminde bir görsel yükleyin.");
    }
    return { url: `blob:${file.name}`, alt: file.name, aspectRatio: "1:1" as const };
  }),
  loadCoverFile: vi.fn(async (file: File) => ({
    url: `blob:${file.name}`,
    alt: file.name,
  })),
  loadVideoFile: vi.fn(async (file: File) => ({ url: `blob:${file.name}` })),
}));

import ExistingPostList from "./ExistingPostList";

afterEach(() => cleanup());

function imageFile(name: string): File {
  return new File(["x"], name, { type: "image/png" });
}

function invalidFile(name: string): File {
  return new File(["x"], name, { type: "image/gif" });
}

function fileInputs(): NodeListOf<HTMLInputElement> {
  return document.querySelectorAll('input[type="file"]');
}

function imageInput(): HTMLInputElement {
  return [...fileInputs()].find(
    (input) => input.accept.includes("image/") && input.multiple,
  )!;
}

/** Parent (`GridManager.handleExistingUpload`) davranısını taklit eder. */
function accumulate(
  uploads: Array<Parameters<typeof addExistingPost>[1]>,
): ExistingPost[] {
  let posts: ExistingPost[] = [];
  for (const input of uploads) {
    posts = addExistingPost(posts, { ...input, recency: "enYeni" }).posts;
  }
  return posts;
}

describe("ExistingPostList — çoklu görsel yükleme", () => {
  it("normal görsel input multiple destekler", () => {
    render(<ExistingPostList posts={[]} pinnedCount={0} pinError={null} onUpload={vi.fn()} onDelete={vi.fn()} onTogglePin={vi.fn()} onMovePinned={vi.fn()} onPostTypeChange={vi.fn()} onSelect={vi.fn()} />);
    const input = imageInput();
    expect(input).toBeDefined();
    expect(input.multiple).toBe(true);
  });

  it("3 görsel aynı anda seçilince 3 ayrı içerik yüklenir", async () => {
    const onUpload = vi.fn();
    render(<ExistingPostList posts={[]} pinnedCount={0} pinError={null} onUpload={onUpload} onDelete={vi.fn()} onTogglePin={vi.fn()} onMovePinned={vi.fn()} onPostTypeChange={vi.fn()} onSelect={vi.fn()} />);
    await act(async () => {
      fireEvent.change(imageInput(), {
        target: { files: [imageFile("gorsel-1.jpg"), imageFile("gorsel-2.png"), imageFile("gorsel-3.webp")] },
      });
    });
    expect(onUpload).toHaveBeenCalledTimes(3);
    const uploadedNames = onUpload.mock.calls.map((call) => call[0].alt);
    expect(uploadedNames).toContain("gorsel-1.jpg");
    expect(uploadedNames).toContain("gorsel-2.png");
    expect(uploadedNames).toContain("gorsel-3.webp");
  });

  it("seçilen dosya sırası 'en yeni' modunda korunur (grid sırası = seçim sırası)", async () => {
    const onUpload = vi.fn();
    render(<ExistingPostList posts={[]} pinnedCount={0} pinError={null} onUpload={onUpload} onDelete={vi.fn()} onTogglePin={vi.fn()} onMovePinned={vi.fn()} onPostTypeChange={vi.fn()} onSelect={vi.fn()} />);
    await act(async () => {
      fireEvent.change(imageInput(), {
        target: { files: [imageFile("bir.png"), imageFile("iki.png"), imageFile("uc.png")] },
      });
    });
    // Parent accumulation ile son durum: ilk seçilen en üstte (recencyIndex 0).
    const posts = accumulate(onUpload.mock.calls.map((call) => call[0]));
    const byRecency = [...posts].sort((a, b) => a.recencyIndex - b.recencyIndex);
    expect(byRecency.map((post) => post.alt)).toEqual(["bir.png", "iki.png", "uc.png"]);
    expect(byRecency[0].id).not.toBe(byRecency[1].id);
    expect(new Set(posts.map((post) => post.id)).size).toBe(3);
  });

  it("bir dosya geçersizse diğerleri yüklenir ve hata açık raporlanır", async () => {
    const onUpload = vi.fn();
    render(<ExistingPostList posts={[]} pinnedCount={0} pinError={null} onUpload={onUpload} onDelete={vi.fn()} onTogglePin={vi.fn()} onMovePinned={vi.fn()} onPostTypeChange={vi.fn()} onSelect={vi.fn()} />);
    await act(async () => {
      fireEvent.change(imageInput(), {
        target: { files: [imageFile("ok1.png"), invalidFile("abc.gif"), imageFile("ok2.png")] },
      });
    });
    await waitFor(() => expect(onUpload).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("alert").textContent).toContain("abc.gif");
    expect(screen.getByRole("alert").textContent).toContain("Desteklenmeyen dosya türü");
  });

  it("çoklu seçim yardımcı metni gösterir", () => {
    render(<ExistingPostList posts={[]} pinnedCount={0} pinError={null} onUpload={vi.fn()} onDelete={vi.fn()} onTogglePin={vi.fn()} onMovePinned={vi.fn()} onPostTypeChange={vi.fn()} onSelect={vi.fn()} />);
    expect(screen.getByText("Birden fazla JPG, PNG veya WebP seçebilirsiniz.")).toBeDefined();
  });
});

describe("ExistingPostList — Reel tek dosya akışı", () => {
  function renderReel(onUpload: ReturnType<typeof vi.fn>) {
    const view = render(<ExistingPostList posts={[]} pinnedCount={0} pinError={null} onUpload={onUpload} onDelete={vi.fn()} onTogglePin={vi.fn()} onMovePinned={vi.fn()} onPostTypeChange={vi.fn()} onSelect={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("İçerik türü"), { target: { value: "reel" } });
    return view;
  }

  it("reel video input'u tekli (multiple === false)", () => {
    renderReel(vi.fn());
    const videoInput = [...fileInputs()].find((input) => input.accept === "video/mp4,video/webm")!;
    expect(videoInput).toBeDefined();
    expect(videoInput.multiple).toBe(false);
  });

  it("reel kapak input'u tekli (multiple === false)", () => {
    renderReel(vi.fn());
    const coverInput = [...fileInputs()].find(
      (input) => input.accept.includes("image/") && !input.multiple,
    )!;
    expect(coverInput).toBeDefined();
    expect(coverInput.multiple).toBe(false);
  });

  it("video olmadan Reel ekle devre dışı kalır", () => {
    renderReel(vi.fn());
    const addButton = screen.getByRole("button", { name: "Reel ekle" });
    expect((addButton as HTMLButtonElement).disabled).toBe(true);
  });

  it("1 kapak + 1 video ile reel oluşturulur (cover + videoUrl)", async () => {
    const onUpload = vi.fn();
    renderReel(onUpload);
    const coverInput = [...fileInputs()].find(
      (input) => input.accept.includes("image/") && !input.multiple,
    )!;
    const videoInput = [...fileInputs()].find((input) => input.accept === "video/mp4,video/webm")!;
    await act(async () => {
      fireEvent.change(coverInput, { target: { files: [imageFile("kapak.png")] } });
      fireEvent.change(videoInput, { target: { files: [new File(["x"], "reel.mp4", { type: "video/mp4" })] } });
    });
    const addButton = screen.getByRole("button", { name: "Reel ekle" }) as HTMLButtonElement;
    expect(addButton.disabled).toBe(false);
    await act(async () => {
      fireEvent.click(addButton);
    });
    expect(onUpload).toHaveBeenCalledTimes(1);
    const input = onUpload.mock.calls[0][0];
    expect(input.postType).toBe("reel");
    expect(input.mediaType).toBe("video");
    expect(input.videoUrl).toBe("blob:reel.mp4");
    expect(input.coverImageUrl).toBe("blob:kapak.png");
    // Grid hücresi kapak görselini gösterir.
    expect(input.url).toBe("blob:kapak.png");
  });
});
