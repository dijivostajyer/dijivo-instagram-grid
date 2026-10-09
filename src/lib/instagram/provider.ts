import type { InstagramProvider } from "./types";
import { BrightDataInstagramProvider } from "./brightdata";

/**
 * Instagram provider interface'i.
 * Gerçek provider implementation'ları bu interface'i implement eder.
 * Yapılandırılmamış durumda asla mock/sahte profil dönülmez.
 */
export function createInstagramProvider(): InstagramProvider | null {
  const providerType = process.env.INSTAGRAM_PROVIDER?.trim().toLowerCase();
  const apiKey = process.env.INSTAGRAM_PROVIDER_API_KEY?.trim();
  if (!providerType || !apiKey) return null;

  if (providerType === "brightdata") {
    const datasetId = process.env.INSTAGRAM_PROFILE_DATASET_ID?.trim();
    if (!datasetId) {
      console.error("[instagram] Bright Data profil dataset yapılandırması eksik.");
      return null;
    }
    return new BrightDataInstagramProvider({ apiKey, datasetId });
  }

  // Yeni sağlayıcılar burada açıkça eklenir. Her implementation yalnız
  // server-side ortam değişkenlerinden anahtar almalı ve raw response'u
  // normalize katmanından önce tarayıcıya asla göndermemelidir.
  console.warn("[instagram] Desteklenmeyen provider yapılandırması", { providerType });
  return null;
}
