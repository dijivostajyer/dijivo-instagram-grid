// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import StoryViewer from "./StoryViewer";
import type { Story } from "@/lib/types";

const brand = { id: "b", name: "Marka", username: "marka" };
const stories: Story[] = [
  { id: "s1", mediaType: "image", mediaUrl: "https://cdn.test/s1.jpg", sortOrder: 0, createdAt: "2026-10-01T00:00:00.000Z" },
  { id: "s2", mediaType: "image", mediaUrl: "https://cdn.test/s2.jpg", sortOrder: 1, createdAt: "2026-10-01T00:00:00.000Z" },
];

beforeEach(() => vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance", "setTimeout"] }));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const currentSrc = () => (screen.getByAltText("Story") as HTMLImageElement).src;

describe("StoryViewer otomatik ilerleme ve geri bildirim alanı", () => {
  it("görsel Story yaklaşık 5 saniyede ilerler", () => {
    render(<StoryViewer brand={brand} stories={stories} onClose={() => undefined} />);
    act(() => { vi.advanceTimersByTime(4_000); });
    expect(currentSrc()).toContain("s1.jpg");
    act(() => { vi.advanceTimersByTime(1_500); });
    expect(currentSrc()).toContain("s2.jpg");
  });

  it("geri bildirim formu açıkken (paused) ilerlemez; kapanınca kaldığı yerden devam eder", () => {
    render(
      <StoryViewer
        brand={brand}
        stories={stories}
        onClose={() => undefined}
        footer={(story, controls) => (
          <div>
            <button type="button" onClick={() => controls.setPaused(true)}>Formu aç</button>
            <button type="button" onClick={() => controls.setPaused(false)}>Formu kapat</button>
            <span>{story.id}</span>
          </div>
        )}
      />,
    );
    act(() => { vi.advanceTimersByTime(3_000); });
    fireEvent.click(screen.getByRole("button", { name: "Formu aç" }));
    act(() => { vi.advanceTimersByTime(20_000); });
    expect(currentSrc()).toContain("s1.jpg");
    fireEvent.click(screen.getByRole("button", { name: "Formu kapat" }));
    act(() => { vi.advanceTimersByTime(1_500); });
    expect(currentSrc()).toContain("s1.jpg");
    act(() => { vi.advanceTimersByTime(1_000); });
    expect(currentSrc()).toContain("s2.jpg");
    expect(screen.getByText("s2")).toBeTruthy();
  });

  it("geri bildirim alanı varken kart 9:16 oranında kalır", () => {
    render(<StoryViewer brand={brand} stories={stories} onClose={() => undefined} footer={() => <span>alan</span>} />);
    const card = screen.getByAltText("Story").parentElement as HTMLElement;
    expect(card.style.aspectRatio).toBe("9 / 16");
  });
});
