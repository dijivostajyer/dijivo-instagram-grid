import { afterEach, describe, expect, it, vi } from "vitest";

import { createInstagramProvider } from "./provider";

afterEach(() => vi.unstubAllEnvs());

describe("Instagram provider yapılandırması", () => {
  it("sağlayıcı veya anahtar yoksa mock yerine null döner", () => {
    vi.stubEnv("INSTAGRAM_PROVIDER", "");
    vi.stubEnv("INSTAGRAM_PROVIDER_API_KEY", "");
    expect(createInstagramProvider()).toBeNull();
  });

  it("bilinmeyen sağlayıcıyı sahte veri üretmeden reddeder", () => {
    vi.stubEnv("INSTAGRAM_PROVIDER", "bilinmeyen");
    vi.stubEnv("INSTAGRAM_PROVIDER_API_KEY", "secret-degil");
    expect(createInstagramProvider()).toBeNull();
  });
});
