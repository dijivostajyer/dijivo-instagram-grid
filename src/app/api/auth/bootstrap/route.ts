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

export async function GET() {
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
