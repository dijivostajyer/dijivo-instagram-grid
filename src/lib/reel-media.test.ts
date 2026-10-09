import { describe, expect, it } from "vitest";

import { isInstagramPostUrl, isPlayableVideoUrl } from "./reel-media";

describe("Reel medya ayrımı", () => {
  it("Instagram Reel permalink'ini video kaynağı olarak kabul etmez", () => {
    const permalink = "https://www.instagram.com/reel/C0ffee/";
    expect(isInstagramPostUrl(permalink)).toBe(true);
    expect(isPlayableVideoUrl(permalink)).toBe(false);
  });

  it("bilinen oynatılabilir video ve workspace referanslarını kabul eder", () => {
    expect(isPlayableVideoUrl("https://cdn.example.test/media/reel.mp4?token=ok")).toBe(true);
    expect(isPlayableVideoUrl("storage:workspace-media/user/brand/reel.mp4")).toBe(true);
  });

  it("uzantısı olmayan genel URL'yi video diye varsaymaz", () => {
    expect(isPlayableVideoUrl("https://www.instagram.com/p/example/")).toBe(false);
    expect(isPlayableVideoUrl("https://cdn.example.test/media/reel")).toBe(false);
  });
});
