import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { authenticateRequest } from "./server-auth";

/**
 * Takvim API yetkilendirmesi. Takvim depo katmanı service-role ile çalışır (RLS'yi atlar),
 * bu yüzden her handler önce oturumu doğrular, sonra markanın (ve verilmişse aylık planın)
 * GERÇEKTEN oturumdaki kullanıcıya ait olduğunu `workspace_brands` / `workspace_projects`
 * üzerinden kontrol eder. İstemciden gelen brandId/projectId/item kimliği tek başına
 * yetki kanıtı sayılmaz. Sahibi olmayan ve var olmayan kayıtlar aynı yanıtı alır (bilgi sızdırmaz).
 */

export type CalendarAuth = { ok: true; userId: string } | { ok: false; response: NextResponse };

/** Oturumsuz → 401; sunucu yapılandırması eksik → 503. */
export async function authenticateCalendarRequest(request: Request, env: NodeJS.ProcessEnv = process.env): Promise<CalendarAuth> {
  const user = await authenticateRequest(request, env);
  if (!user.ok) return { ok: false, response: NextResponse.json({ error: user.error }, { status: user.status }) };
  return { ok: true, userId: user.userId };
}

const NOT_FOUND_MESSAGE =
  "Marka veya aylık plan bulunamadı. Çalışma alanı henüz kaydediliyor olabilir; lütfen kısa süre sonra tekrar deneyin.";

/**
 * Marka (ve verilmişse plan) oturumdaki kullanıcıya ait mi? Aitse `null`, değilse
 * reddeden yanıt (404; veritabanı hatasında 500). Plan, belirtilen markaya da ait olmalıdır.
 */
export async function assertCalendarScope(
  userId: string,
  scope: { brandId: string; projectId?: string },
  env: NodeJS.ProcessEnv = process.env,
): Promise<NextResponse | null> {
  const url = env.SUPABASE_URL?.trim();
  const secret = env.SUPABASE_SECRET_KEY?.trim();
  if (!url || !secret) return NextResponse.json({ error: "Sunucu Supabase yapılandırması eksik." }, { status: 503 });
  const client = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });

  const brand = await client
    .from("workspace_brands")
    .select("id")
    .eq("id", scope.brandId)
    .eq("user_id", userId)
    .maybeSingle();
  if (brand.error) {
    console.error("[calendar-authz]", { event: "brand_check_failed", errorCode: brand.error.code });
    return NextResponse.json({ error: "Yetki doğrulanamadı." }, { status: 500 });
  }
  if (!brand.data) return NextResponse.json({ error: NOT_FOUND_MESSAGE }, { status: 404 });

  if (scope.projectId !== undefined) {
    const project = await client
      .from("workspace_projects")
      .select("id")
      .eq("id", scope.projectId)
      .eq("brand_id", scope.brandId)
      .eq("user_id", userId)
      .maybeSingle();
    if (project.error) {
      console.error("[calendar-authz]", { event: "project_check_failed", errorCode: project.error.code });
      return NextResponse.json({ error: "Yetki doğrulanamadı." }, { status: 500 });
    }
    if (!project.data) return NextResponse.json({ error: NOT_FOUND_MESSAGE }, { status: 404 });
  }
  return null;
}

const POST_NOT_FOUND_MESSAGE =
  "Bağlanacak gönderi bulunamadı veya bu markaya ait değil. Gönderi henüz kaydediliyor olabilir; lütfen kısa süre sonra tekrar deneyin.";

/**
 * Takvim kaydına bağlanacak gönderi (postId), oturumdaki kullanıcıya ve BU markaya ait mi?
 * Kaynak: `workspace_posts` (id, brand_id, user_id). İstemcinin gönderdiği postId tek başına güvenilmez.
 * Aitse `null`; değilse 400 (bulunamayan ve başkasına ait aynı yanıt), sorgu hatasında 500 (fail-closed).
 */
export async function assertPostInBrand(
  userId: string,
  brandId: string,
  postId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<NextResponse | null> {
  const url = env.SUPABASE_URL?.trim();
  const secret = env.SUPABASE_SECRET_KEY?.trim();
  if (!url || !secret) return NextResponse.json({ error: "Sunucu Supabase yapılandırması eksik." }, { status: 503 });
  const client = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
  const post = await client
    .from("workspace_posts")
    .select("id")
    .eq("id", postId)
    .eq("brand_id", brandId)
    .eq("user_id", userId)
    .maybeSingle();
  if (post.error) {
    console.error("[calendar-authz]", { event: "post_check_failed", errorCode: post.error.code });
    return NextResponse.json({ error: "Yetki doğrulanamadı." }, { status: 500 });
  }
  if (!post.data) return NextResponse.json({ error: POST_NOT_FOUND_MESSAGE }, { status: 400 });
  return null;
}
