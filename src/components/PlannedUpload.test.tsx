// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { act } from "react";

import { addPlannedPost } from "@/lib/post-ops";
import type { PlannedPost } from "@/lib/types";

// Gerçek görsel decode'ı jsdom'da çalışmaz; doğrulama
// katmanı taklidi edilir.
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

import PlannedUpload from "./PlannedUpload";

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

/** Parent (`GridManager.handlePlannedUpload`) davranısını taklit eder. */
function accumulate(
  uploads: Array<Parameters<typeof addPlannedPost>[1]>,
): PlannedPost[] {
  let posts: PlannedPost[] = [];
  for (const input of uploads) {
    posts = addPlannedPost(posts, { ...input, postType: input.postType ?? "post" }).posts;
  }
  return posts;
}

describe("PlannedUpload — çoklu görsel yükleme", () => {
  it("planlanan görsel input multiple destekler", () => {
    render(<PlannedUpload onUpload={vi.fn()} />);
    expect(imageInput().multiple).toBe(true);
  });

  it("10 görsel seçilince 10 planlanan içerik oluşturulur", async () => {
    const onUpload = vi.fn();
    render(<PlannedUpload onUpload={onUpload} />);
    const files = Array.from({ length: 10 }, (_, i) => imageFile(`gorsel-${i + 1}.png`));
    await act(async () => {
      fireEvent.change(imageInput(), { target: { files } });
    });
    await waitFor(() => expect(onUpload).toHaveBeenCalledTimes(10));
    const posts = accumulate(
      onUpload.mock.calls.map((call) => ({
        imageUrl: call[0],
        alt: call[1],
        postType: call[2],
      })),
    );
    expect(posts).toHaveLength(10);
    expect(new Set(posts.map((post) => post.id)).size).toBe(10);
  });

  it("seçilen dosya sırası yayın sırasına (planOrder) korunur", async () => {
    const onUpload = vi.fn();
    render(<PlannedUpload onUpload={onUpload} />);
    await act(async () => {
      fireEvent.change(imageInput(), {
        target: { files: [imageFile("ilk.png"), imageFile("ikinci.png"), imageFile("üçüncü.png")] },
      });
    });
    const posts = accumulate(onUpload.mock.calls.map((call) => ({ imageUrl: call[0], alt: call[1] })));
    const byOrder = [...posts].sort((a, b) => a.planOrder - b.planOrder);
    expect(byOrder.map((post) => post.alt)).toEqual(["ilk.png", "ikinci.png", "üçüncü.png"]);
  });

  it("geçersiz dosya batch'i iptal etmez; diğerleri yüklenir", async () => {
    const onUpload = vi.fn();
    render(<PlannedUpload onUpload={onUpload} />);
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
    render(<PlannedUpload onUpload={vi.fn()} />);
    expect(screen.getByText("Birden fazla JPG, PNG veya WebP seçebilirsiniz.")).toBeDefined();
  });
});

describe("PlannedUpload — Reel tek dosya akışı", () => {
  function renderReel(onUpload: ReturnType<typeof vi.fn>) {
    render(<PlannedUpload onUpload={onUpload} />);
    fireEvent.change(screen.getByLabelText("Planlanan içerik türü"), { target: { value: "reel" } });
  }

  it("reel video input'u tekli (multiple === false)", () => {
    renderReel(vi.fn());
    const videoInput = [...fileInputs()].find((input) => input.accept === "video/mp4,video/webm")!;
    expect(videoInput.multiple).toBe(false);
  });

  it("reel kapak input'u tekli (multiple === false)", () => {
    renderReel(vi.fn());
    const coverInput = [...fileInputs()].find(
      (input) => input.accept.includes("image/") && !input.multiple,
    )!;
    expect(coverInput.multiple).toBe(false);
  });

  it("video olmadan Reel ekle devre dışı; video gelince aktif", async () => {
    renderReel(vi.fn());
    const addButton = screen.getByRole("button", { name: "Reel ekle" }) as HTMLButtonElement;
    expect(addButton.disabled).toBe(true);
    const videoInput = [...fileInputs()].find((input) => input.accept === "video/mp4,video/webm")!;
    await act(async () => {
      fireEvent.change(videoInput, { target: { files: [new File(["x"], "reel.mp4", { type: "video/mp4" })] } });
    });
    expect(addButton.disabled).toBe(false);
  });

  it("kapak + video ile reel planlanan içerik oluşturulur", async () => {
    const onUpload = vi.fn();
    renderReel(onUpload);
    const coverInput = [...fileInputs()].find(
      (input) => input.accept.includes("image/") && !input.multiple,
    )!;
    const videoInput = [...fileInputs()].find(
      (input) => input.accept === "video/mp4,video/webm",
    )!;
    await act(async () => {
      fireEvent.change(coverInput, { target: { files: [imageFile("kapak.png")] } });
      fireEvent.change(videoInput, { target: { files: [new File(["x"], "reel.mp4", { type: "video/mp4" })] } });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Reel ekle" }));
    });
    expect(onUpload).toHaveBeenCalledTimes(1);
    const [url, alt, postType, , reel] = onUpload.mock.calls[0];
    expect(postType).toBe("reel");
    expect(url).toBe("blob:kapak.png");
    expect(alt).toBe("kapak.png");
    expect(reel.videoUrl).toBe("blob:reel.mp4");
    expect(reel.coverImageUrl).toBe("blob:kapak.png");
  });

  it("reel metni tek video olduğunu belirtir", () => {
    renderReel(vi.fn());
    expect(screen.getByText(/Tek video/)).toBeDefined();
  });
});
