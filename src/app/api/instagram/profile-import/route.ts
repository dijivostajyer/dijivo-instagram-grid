import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

import { normalizeInstagramProfile, parseInstagramUrl } from "@/lib/instagram/normalize";
import { createInstagramProvider } from "@/lib/instagram/provider";

async function hasAuthenticatedUser(request: Request): Promise<boolean> {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const url = process.env.SUPABASE_URL?.trim();
  const secret = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!token || !url || !secret) return false;
  const client = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.auth.getUser(token);
  return !error && Boolean(data.user);
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    const url = typeof body?.url === "string" ? body.url.trim() : "";

    if (!url) {
      return NextResponse.json(
        { error: "Instagram profil bağlantısı gerekli." },
        { status: 400 },
      );
    }

    if (!(await hasAuthenticatedUser(request))) {
      return NextResponse.json({ error: "Instagram bilgilerini almak için giriş yapın." }, { status: 401 });
    }

    // URL parse et
    const parsed = parseInstagramUrl(url);
    if (!parsed.ok || !parsed.username) {
      return NextResponse.json(
        { error: parsed.error || "Geçersiz Instagram profil bağlantısı." },
        { status: 400 },
      );
    }

    // Provider yalnız server-side ortamında çalışır; client'a raw yanıt dönmez.
    const provider = createInstagramProvider();
    if (!provider) {
      return NextResponse.json(
        { error: "Instagram veri sağlayıcısı yapılandırılmamış.", code: "INSTAGRAM_PROVIDER_NOT_CONFIGURED" },
        { status: 503 },
      );
    }
    const result = await provider.fetchProfile(parsed.username);

    if (!result.ok || !result.profile) {
      const warning = result.warnings?.[0] || "Instagram bilgileri şu anda alınamıyor.";
      return NextResponse.json(
        { error: warning },
        { status: 503 },
      );
    }

    const profile = result.profile;
    const recentPosts = profile.recentPosts?.length
      ? result.profile.recentPosts
      : await provider.fetchRecentPosts(parsed.username).catch(() => []);
    return NextResponse.json({
      ok: true,
      profile: normalizeInstagramProfile({ ...profile, recentPosts }),
      warnings: result.warnings,
    });
  } catch (error) {
    console.error("[instagram/profile-import] Sağlayıcı isteği başarısız:", error instanceof Error ? error.message : "bilinmeyen hata");
    return NextResponse.json(
      { error: "Instagram bilgileri alınamadı." },
      { status: 500 },
    );
  }
}
