// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

import PostModal from "./PostModal";
import type { ExistingPost } from "@/lib/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(cleanup);

const brand = { id: "brand-a", name: "Marka", username: "marka" };

function reel(overrides: Partial<ExistingPost> = {}): ExistingPost {
  return {
    id: "reel-1",
    source: "mevcut",
    imageUrl: "blob:kapak",
    coverImageUrl: "blob:kapak",
    videoUrl: "blob:video",
    mediaType: "video",
    postType: "reel",
    recencyIndex: 0,
    pinned: false,
    ...overrides,
  };
}

function renderModal(post: ExistingPost, handlers: { onRemoveVideo?: () => Promise<void>; onRemoveCover?: () => Promise<void> }) {
  return render(
    <PostModal
      post={post}
      source="mevcut"
      brand={brand}
      allProjects={[]}
      brands={[brand]}
      onPostTypeChange={() => undefined}
      onCaptionChange={() => undefined}
      onChangeImage={async () => undefined}
      onChangeVideo={async () => undefined}
      onChangeCover={async () => undefined}
      onRemoveVideo={handlers.onRemoveVideo}
      onRemoveCover={handlers.onRemoveCover}
      onCopy={() => null}
      onClose={() => undefined}
    />,
  );
}

describe("PostModal — Reel video/kapak kaldırma (R2)", () => {
  it("kaldırma iki adımlıdır: ilk tıklama onay ister, ikincisi uygular", async () => {
    const onRemoveVideo = vi.fn(async () => undefined);
    renderModal(reel({ videoUrl: "blob:video", imageUrl: "blob:kapak" }), { onRemoveVideo });
    fireEvent.click(screen.getByRole("button", { name: "Videoyu kaldır" }));
    expect(onRemoveVideo).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Kaldırmak için tekrar tıklayın" }));
    });
    expect(onRemoveVideo).toHaveBeenCalledTimes(1);
  });

  it("kapak kaldırma başarısızsa anlaşılır hata gösterilir", async () => {
    const onRemoveCover = vi.fn(async () => {
      throw new Error("Kapak kaldırılamadı: videodan otomatik görsel alınamadı. Kapağı değiştirmeyi deneyin.");
    });
    renderModal(reel({ imageUrl: "blob:kapak" }), { onRemoveCover });
    fireEvent.click(screen.getByRole("button", { name: "Kapağı kaldır" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Kaldırmak için tekrar tıklayın" }));
    });
    expect(screen.getByRole("alert").textContent).toContain("Kapak kaldırılamadı");
  });

  it("ayrı kapak yoksa Kapağı kaldır gösterilmez", () => {
    renderModal(reel({ coverImageUrl: undefined, imageUrl: "blob:poster" }), { onRemoveCover: vi.fn(async () => undefined), onRemoveVideo: vi.fn(async () => undefined) });
    expect(screen.queryByRole("button", { name: "Kapağı kaldır" })).toBeNull();
    expect(screen.getByRole("button", { name: "Videoyu kaldır" })).toBeDefined();
  });

  it("görsel yuvası videonun kendisiyse (eski kapaksız Reel) Videoyu kaldır gizlenir", () => {
    renderModal(reel({ coverImageUrl: undefined, imageUrl: "blob:video", videoUrl: "blob:video" }), { onRemoveVideo: vi.fn(async () => undefined) });
    expect(screen.queryByRole("button", { name: "Videoyu kaldır" })).toBeNull();
  });
});
