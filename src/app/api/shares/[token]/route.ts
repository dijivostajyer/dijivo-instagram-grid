import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

import { authenticateRequest } from "@/lib/server-auth";
import { isValidShareToken } from "@/lib/share-token";
import { getShareStore } from "@/lib/share-store";

const NOT_FOUND = { error: "Paylaşım bağlantısı bulunamadı." };

/**
 * Paylaşım sahipliği (şema değişikliği olmadan): snapshot'taki `context.brandId` markasının sahibi.
 * Bağlamı olmayan/markası silinmiş eski kayıtlar yalnız çalışma alanı sahibine (workspace_bootstrap.owner_id) açıktır.
 */
async function userMayRevoke(userId: string, brandId: string | undefined): Promise<boolean | "error"> {
  const url = process.env.SUPABASE_URL?.trim();
  const secret = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!url || !secret) return "error";
  const client = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
  if (brandId) {
    const brand = await client.from("workspace_brands").select("user_id").eq("id", brandId).maybeSingle();
    if (brand.error) return "error";
    if (typeof brand.data?.user_id === "string") return brand.data.user_id === userId;
  }
  const bootstrap = await client.from("workspace_bootstrap").select("owner_id").eq("id", true).maybeSingle();
  if (bootstrap.error) return "error";
  return typeof bootstrap.data?.owner_id === "string" && bootstrap.data.owner_id === userId;
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const user = await authenticateRequest(request);
  if (!user.ok) {
    return NextResponse.json({ error: user.status === 401 ? "Paylaşım bağlantısını kaldırmak için giriş yapın." : user.error }, { status: user.status });
  }
  const { token } = await params;
  if (!isValidShareToken(token)) return NextResponse.json({ error: "Geçersiz paylaşım bağlantısı." }, { status: 400 });
  try {
    const store = getShareStore();
    const snapshot = await store.peek(token);
    // Bulunamayan/iptal edilmiş/süresi dolmuş ile başkasına ait aynı yanıtı alır (bilgi sızdırmaz).
    if (!snapshot) return NextResponse.json(NOT_FOUND, { status: 404 });
    const allowed = await userMayRevoke(user.userId, snapshot.context?.brandId);
    if (allowed === "error") return NextResponse.json({ error: "Yetki doğrulanamadı." }, { status: 500 });
    if (!allowed) return NextResponse.json(NOT_FOUND, { status: 404 });
    await store.revoke(token);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const step = "revoke_snapshot";
    const errorName = error instanceof Error ? error.name : "UnknownError";
    const errorMessage = error instanceof Error ? error.message : "Bilinmeyen hata";
    console.error("[share-api]", { step, errorName, error: errorMessage });
    return NextResponse.json({ error: "Paylaşım bağlantısı kaldırılamadı." }, { status: 500 });
  }
}
