import { createClient } from "@supabase/supabase-js";

export type RequestUser = { ok: true; userId: string } | { ok: false; status: 401 | 503; error: string };

/**
 * Bearer token'ı Supabase Auth ile doğrular (getUser: süresi dolmuş veya
 * iptal edilmiş oturum kabul edilmez). Yalnız sunucuda kullanılır.
 */
export async function authenticateRequest(request: Request, env: NodeJS.ProcessEnv = process.env): Promise<RequestUser> {
  const url = env.SUPABASE_URL?.trim();
  const secret = env.SUPABASE_SECRET_KEY?.trim();
  if (!url || !secret) return { ok: false, status: 503, error: "Sunucu Supabase yapılandırması eksik." };
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!token) return { ok: false, status: 401, error: "Bu işlem için giriş yapın." };
  const client = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) return { ok: false, status: 401, error: "Oturum doğrulanamadı. Lütfen tekrar giriş yapın." };
  return { ok: true, userId: data.user.id };
}
