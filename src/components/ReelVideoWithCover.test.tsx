// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";

import ReelVideoWithCover from "./ReelVideoWithCover";

afterEach(() => cleanup());

function setup(coverUrl?: string) {
  const videoRef = createRef<HTMLVideoElement>();
  render(
    <ReelVideoWithCover
      videoUrl="blob:video"
      coverUrl={coverUrl}
      title="Reel 1"
      videoRef={videoRef}
      videoAriaLabel="Reel videosu"
      onVideoError={() => {}}
    />,
  );
  return videoRef;
}

describe("ReelVideoWithCover", () => {
  it("kapak yoksa sekme çubuğu çıkmaz, yalnız video gösterilir", () => {
    setup();
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.getByLabelText("Reel videosu")).toBeDefined();
    expect(screen.queryByAltText("Reel kapağı: Reel 1")).toBeNull();
  });

  it("kapak varsa Video ve Kapak sekmeleri çıkar; varsayılan Video", () => {
    setup("blob:cover");
    expect(screen.getByRole("tab", { name: "Video" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tab", { name: "Kapak" }).getAttribute("aria-selected")).toBe("false");
    expect(document.getElementById("reel-panel-video")?.hasAttribute("hidden")).toBe(false);
  });

  it("Kapak sekmesi kapağı gösterir, videoyu durdurur ve kırpmaz", () => {
    const ref = setup("blob:cover");
    const pause = vi.spyOn(ref.current!, "pause").mockImplementation(() => {});
    fireEvent.click(screen.getByRole("tab", { name: "Kapak" }));
    expect(pause).toHaveBeenCalled();
    const cover = screen.getByAltText("Reel kapağı: Reel 1");
    expect(cover.className).toContain("object-contain");
    expect(screen.getByRole("tab", { name: "Kapak" }).getAttribute("aria-selected")).toBe("true");
    expect(document.getElementById("reel-panel-cover")?.hasAttribute("hidden")).toBe(false);
    expect(document.getElementById("reel-panel-video")?.hasAttribute("hidden")).toBe(true);
    fireEvent.click(screen.getByRole("tab", { name: "Video" }));
    expect(document.getElementById("reel-panel-video")?.hasAttribute("hidden")).toBe(false);
    expect(document.getElementById("reel-panel-cover")?.hasAttribute("hidden")).toBe(true);
  });
});
