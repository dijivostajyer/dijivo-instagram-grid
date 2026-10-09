import type { InstagramProvider } from "./types";

/**
 * Instagram provider interface'i.
 * Gerçek provider implementation'ları bu interface'i implement eder.
 * Yapılandırılmamış durumda asla mock/sahte profil dönülmez.
 */
export function createInstagramProvider(): InstagramProvider | null {
  const providerType = process.env.INSTAGRAM_PROVIDER?.trim();
  const apiKey = process.env.INSTAGRAM_PROVIDER_API_KEY?.trim();
  if (!providerType || !apiKey) return null;

  // Yeni sağlayıcılar burada açıkça eklenir. Her implementation yalnız
  // server-side ortam değişkenlerinden anahtar almalı ve raw response'u
  // normalize katmanından önce tarayıcıya asla göndermemelidir.
  console.warn("[instagram] Desteklenmeyen provider yapılandırması", { providerType });
  return null;
}
