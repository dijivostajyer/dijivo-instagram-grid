import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

function adminClient() {
  const url = process.env.SUPABASE_URL?.trim();
  const secret = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!url || !secret) return null;
  return createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function hasExistingUser(client: NonNullable<ReturnType<typeof adminClient>>) {
  const { data, error } = await client.auth.admin.listUsers({ page: 1, perPage: 1 });
  if (error) throw error;
  return data.users.length > 0;
}

/**
 * Hedef proje korumasi: bootstrap yalnizca EXPECTED_SUPABASE_PROJECT_REF ile belirtilen projeye
 * karsi calisir. Ref eksik/gecersizse, SUPABASE_URL `<ref>.supabase.co` degilse veya
 * NEXT_PUBLIC_SUPABASE_URL ayni host'a isaret etmiyorsa istek 503 ile durdurulur (fail-closed).
 * Yanitlarda ve loglarda yalnizca neden kodu yer alir; anahtar/URL degeri yazilmaz.
 */
const PROJECT_REF_PATTERN = /^[a-z0-9]{20}$/;

function projectHost(value: string | undefined): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
  if (url.pathname !== "/" || url.search || url.hash) return null;
  return url.hostname;
}

function targetGuard(): NextResponse | null {
  const reason = (() => {
    const ref = process.env.EXPECTED_SUPABASE_PROJECT_REF?.trim();
    if (!ref) return "expected_ref_missing";
    if (!PROJECT_REF_PATTERN.test(ref)) return "expected_ref_invalid";
    const serverHost = projectHost(process.env.SUPABASE_URL);
    if (!serverHost) return "server_url_invalid";
    if (serverHost !== `${ref}.supabase.co`) return "server_url_ref_mismatch";
    const publicHost = projectHost(process.env.NEXT_PUBLIC_SUPABASE_URL);
    if (!publicHost) return "public_url_invalid";
    if (publicHost !== serverHost) return "public_url_mismatch";
    return null;
  })();
  if (!reason) return null;
  console.error(`[auth/bootstrap] Hedef proje korumasi istegi durdurdu: ${reason}`);
  return NextResponse.json({ error: "Bootstrap hedef proje korumasi nedeniyle devre disi." }, { status: 503 });
}

export async function GET() {
  const blocked = targetGuard();
  if (blocked) return NextResponse.json({ canBootstrap: false }, { status: blocked.status });
  try {
    const client = adminClient();
    if (!client) return NextResponse.json({ canBootstrap: false }, { status: 503 });
    return NextResponse.json({ canBootstrap: !(await hasExistingUser(client)) });
  } catch (error) {
    console.error("[auth/bootstrap] Durum okunamadı:", error);
    return NextResponse.json({ canBootstrap: false }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const blocked = targetGuard();
  if (blocked) return blocked;
  const client = adminClient();
  if (!client) return NextResponse.json({ error: "İlk hesap kurulumu yapılandırılmamış." }, { status: 503 });
  const body = await request.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  if (!email || password.length < 6) return NextResponse.json({ error: "Geçerli e-posta ve en az 6 karakter şifre gerekli." }, { status: 400 });

  try {
    if (await hasExistingUser(client)) return NextResponse.json({ error: "İlk hesap zaten oluşturuldu." }, { status: 409 });
    const { error: lockError } = await client.from("workspace_bootstrap").insert({ id: true });
    if (lockError) return NextResponse.json({ error: "İlk hesap kurulumu zaten başlatıldı." }, { status: 409 });

    const { data, error } = await client.auth.admin.createUser({ email, password, email_confirm: true });
    if (error || !data.user) {
      await client.from("workspace_bootstrap").delete().eq("id", true);
      return NextResponse.json({ error: error?.message ?? "Hesap oluşturulamadı." }, { status: 400 });
    }
    const { error: ownerError } = await client.from("workspace_bootstrap").update({ owner_id: data.user.id }).eq("id", true);
    if (ownerError) console.error("[auth/bootstrap] Bootstrap sahibi kaydedilemedi:", ownerError);
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    console.error("[auth/bootstrap] İlk hesap oluşturulamadı:", error);
    return NextResponse.json({ error: "İlk hesap oluşturulamadı." }, { status: 500 });
  }
}
