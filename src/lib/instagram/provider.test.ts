import { afterEach, describe, expect, it, vi } from "vitest";

import { BrightDataInstagramProvider } from "./brightdata";
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

  it("brightdata için yalnız server-side anahtar ve dataset kimliğiyle provider oluşturur", () => {
    vi.stubEnv("INSTAGRAM_PROVIDER", "brightdata");
    vi.stubEnv("INSTAGRAM_PROVIDER_API_KEY", "secret-degil");
    vi.stubEnv("INSTAGRAM_PROFILE_DATASET_ID", "gd_test");
    expect(createInstagramProvider()).toBeInstanceOf(BrightDataInstagramProvider);
  });
});
