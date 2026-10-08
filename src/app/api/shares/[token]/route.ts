import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

import { isValidShareToken } from "@/lib/share-token";
import { getShareStore } from "@/lib/share-store";

async function isAuthenticated(request: Request): Promise<boolean> {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const url = process.env.SUPABASE_URL?.trim();
  const secret = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!token || !url || !secret) return false;
  const client = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.auth.getUser(token);
  return !error && Boolean(data.user);
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  if (!(await isAuthenticated(request))) return NextResponse.json({ error: "Paylaşım bağlantısını kaldırmak için giriş yapın." }, { status: 401 });
  const { token } = await params;
  if (!isValidShareToken(token)) return NextResponse.json({ error: "Geçersiz paylaşım bağlantısı." }, { status: 400 });
  try {
    await getShareStore().revoke(token);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[share] Snapshot kaldırılamadı:", error);
    return NextResponse.json({ error: "Paylaşım bağlantısı kaldırılamadı." }, { status: 500 });
  }
}
