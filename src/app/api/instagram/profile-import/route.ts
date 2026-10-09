import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

import { normalizeInstagramProfile, parseInstagramUrl } from "@/lib/instagram/normalize";
import { createInstagramProvider } from "@/lib/instagram/provider";
import { BrightDataInstagramProvider, InstagramProviderError } from "@/lib/instagram/brightdata";

const MAX_JOB_POLLS = 30;

function serverClient() {
  const url = process.env.SUPABASE_URL?.trim();
  const secret = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!url || !secret) return null;
  return createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function authenticatedUserId(request: Request): Promise<string | null> {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const client = serverClient();
  if (!token || !client) return null;
  const { data, error } = await client.auth.getUser(token);
  return error || !data.user ? null : data.user.id;
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

    const userId = await authenticatedUserId(request);
    if (!userId) {
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
    if (provider instanceof BrightDataInstagramProvider) {
      const client = serverClient();
      if (!client) return NextResponse.json({ error: "Instagram içe aktarma yapılandırılmamış." }, { status: 503 });
      const snapshotId = await provider.startProfileImport(parsed.username);
      const { data: job, error: jobError } = await client.from("instagram_import_jobs")
        .insert({ user_id: userId, username: parsed.username, snapshot_id: snapshotId })
        .select("id").single();
      if (jobError || !job) {
        console.error("[instagram/profile-import] İş kaydedilemedi:", { errorName: jobError?.name, errorCode: jobError?.code });
        return NextResponse.json({ error: "Instagram içe aktarma işi kaydedilemedi." }, { status: 500 });
      }
      return NextResponse.json({ ok: true, status: "preparing", jobId: job.id }, { status: 202 });
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
    const message = error instanceof InstagramProviderError
      ? error.userMessage
      : "Instagram bilgileri alınamadı.";
    console.error("[instagram/profile-import] Sağlayıcı isteği başarısız:", {
      errorName: error instanceof Error ? error.name : "UnknownError",
      error: message,
    });
    return NextResponse.json(
      { error: message },
      { status: 500 },
    );
  }
}

export async function GET(request: NextRequest) {
  const userId = await authenticatedUserId(request);
  if (!userId) return NextResponse.json({ error: "Instagram bilgilerini almak için giriş yapın." }, { status: 401 });
  const jobId = new URL(request.url).searchParams.get("jobId") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) return NextResponse.json({ error: "Geçersiz içe aktarma işi." }, { status: 400 });
  const client = serverClient();
  if (!client) return NextResponse.json({ error: "Instagram içe aktarma yapılandırılmamış." }, { status: 503 });

  const { data: job, error } = await client.from("instagram_import_jobs")
    .select("id,username,snapshot_id,status,attempt_count,profile,warnings,error_message,expires_at")
    .eq("id", jobId).eq("user_id", userId).maybeSingle();
  if (error || !job) return NextResponse.json({ error: "İçe aktarma işi bulunamadı." }, { status: 404 });
  if (job.status === "ready" && job.profile) return NextResponse.json({ ok: true, status: "ready", profile: job.profile, warnings: job.warnings });
  if (job.status === "failed" || Date.parse(job.expires_at) <= Date.now() || job.attempt_count >= MAX_JOB_POLLS) {
    await client.from("instagram_import_jobs").update({ status: "failed", error_message: "İçe aktarma zaman aşımına uğradı." }).eq("id", job.id);
    return NextResponse.json({ error: "Instagram bilgileri hazırlanamadı. Lütfen tekrar deneyin." }, { status: 504 });
  }

  const provider = createInstagramProvider();
  if (!(provider instanceof BrightDataInstagramProvider)) return NextResponse.json({ error: "Instagram veri sağlayıcısı yapılandırılmamış." }, { status: 503 });
  try {
    const state = await provider.getProfileImport(job.snapshot_id, job.username);
    if (state.status === "preparing") {
      await client.from("instagram_import_jobs").update({ attempt_count: job.attempt_count + 1 }).eq("id", job.id);
      return NextResponse.json({ ok: true, status: "preparing" }, { status: 202 });
    }
    const profile = normalizeInstagramProfile(state.result.profile!);
    await client.from("instagram_import_jobs").update({ status: "ready", profile, warnings: state.result.warnings ?? [] }).eq("id", job.id);
    return NextResponse.json({ ok: true, status: "ready", profile, warnings: state.result.warnings });
  } catch (caught) {
    const message = caught instanceof InstagramProviderError ? caught.userMessage : "Instagram bilgileri şu anda alınamıyor. Lütfen tekrar deneyin.";
    await client.from("instagram_import_jobs").update({ status: "failed", error_message: message }).eq("id", job.id);
    console.error("[instagram/profile-import] Async iş başarısız:", { errorName: caught instanceof Error ? caught.name : "UnknownError", error: message });
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
