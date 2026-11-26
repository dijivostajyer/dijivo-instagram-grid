import { describe, expect, it } from "vitest";

import { getReelCoverUrl } from "./reel-media";

describe("getReelCoverUrl", () => {
  it("ayrı kapak varsa döner", () => {
    expect(getReelCoverUrl({ coverImageUrl: "blob:c", videoUrl: "blob:v" })).toBe("blob:c");
  });
  it("kapak yoksa veya videonun kendisiyse undefined", () => {
    expect(getReelCoverUrl({ videoUrl: "blob:v" })).toBeUndefined();
    expect(getReelCoverUrl({ coverImageUrl: "blob:v", videoUrl: "blob:v" })).toBeUndefined();
    expect(getReelCoverUrl({ coverImageUrl: "", videoUrl: "blob:v" })).toBeUndefined();
  });
});
