export interface ShareStorageConfig {
  url: string;
  secretKey: string;
  bucket: string;
  ttlDays: number;
}

export function getShareStorageConfig(env: NodeJS.ProcessEnv = process.env): ShareStorageConfig {
  const url = env.SUPABASE_URL;
  const secretKey = env.SUPABASE_SECRET_KEY;
  if (!url || !secretKey) {
    throw new Error("Supabase paylaşım storage yapılandırması eksik.");
  }
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || (parsed.pathname !== "/" && parsed.pathname !== "")) {
      throw new Error("SUPABASE_URL Supabase proje kök URL'si olmalı.");
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("proje kök")) throw error;
    throw new Error("SUPABASE_URL geçersiz.");
  }
  const ttl = Number(env.SHARE_TTL_DAYS ?? "30");
  if (!Number.isInteger(ttl) || ttl <= 0) {
    throw new Error("SHARE_TTL_DAYS pozitif bir tam sayı olmalı.");
  }
  return { url, secretKey, bucket: env.SUPABASE_SHARE_BUCKET ?? "share-images", ttlDays: ttl };
}
