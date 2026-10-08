import { NextResponse } from "next/server";

import {
  validateShareSnapshotInput,
  MAX_SHARE_TOTAL_BYTES,
  MAX_SHARE_TOTAL_VIDEO_BYTES,
} from "@/lib/share";
import { getShareStore } from "@/lib/share-store";
import { createClient } from "@supabase/supabase-js";

type AuthenticationResult = { ok: true } | { ok: false; reason: string };

async function authenticate(request: Request): Promise<AuthenticationResult> {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const url = process.env.SUPABASE_URL?.trim();
  const secret = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!token) return { ok: false, reason: "Authorization bearer token yok." };
  if (!url || !secret) return { ok: false, reason: "Server Supabase yapılandırması eksik." };
  const client = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) return { ok: false, reason: `Auth token doğrulanamadı: ${error?.message ?? "kullanıcı yok"}` };
  return { ok: true };
}

export async function POST(request: Request): Promise<NextResponse> {
  const requestId = crypto.randomUUID();
  try {
    const authentication = await authenticate(request);
    if (!authentication.ok) {
      console.warn("[share] POST yetkilendirme reddedildi", { requestId, reason: authentication.reason });
      return NextResponse.json({ error: "Paylaşım oluşturmak için giriş yapın.", code: "SHARE_UNAUTHORIZED", requestId }, { status: 401 });
    }
    const raw = await request.text();
    const bodyBytes = new TextEncoder().encode(raw).byteLength;
    // Videolar base64 data URL olarak gelir; görsel + video toplam sınırı
    // ayrı ayrı kontrol edilir (Phase 2, §3).
    const videoBytes = countVideoDataUrlBytes(raw);
    if (
      bodyBytes - videoBytes > MAX_SHARE_TOTAL_BYTES * 2 ||
      videoBytes > MAX_SHARE_TOTAL_VIDEO_BYTES * 2
    ) {
      return NextResponse.json({ error: "Paylaşım için yüklenen dosyalar çok büyük." }, { status: 413 });
    }
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { parsed = null; }
    const input = validateShareSnapshotInput(parsed);
    if (!input) {
      console.warn("[share] POST geçersiz payload", { requestId, bodyBytes });
      return NextResponse.json(
        { error: "Paylaşılabilir grid bulunamadı.", code: "SHARE_INVALID_PAYLOAD", requestId },
        { status: 400 },
      );
    }
    console.info("[share] POST payload doğrulandı", { requestId, cells: input.cells.length, bodyBytes, hasVideo: input.cells.some((cell) => Boolean(cell.videoUrl)) });
    const snapshot = await getShareStore().create(input);
    console.info("[share] Snapshot oluşturuldu", { requestId, token: snapshot.token, cells: input.cells.length });
    return NextResponse.json({ token: snapshot.token, requestId }, { status: 201 });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "bilinmeyen hata";
    console.error("[share] Snapshot oluşturulamadı", { requestId, detail });
    const message = error instanceof Error ? error.message : "";
    return NextResponse.json(
      {
        error: message.includes("çok büyük") ? "Paylaşım için yüklenen dosyalar çok büyük." : "Paylaşım bağlantısı oluşturulamadı.",
        code: message.includes("çok büyük") ? "SHARE_PAYLOAD_TOO_LARGE" : "SHARE_CREATE_FAILED",
        requestId,
      },
      { status: message.includes("çok büyük") ? 413 : 500 },
    );
  }
}

/**
 * Gövde içindeki reel video data URL'lerinin yaklaşık bayt miktarı.
 * Doğrulama `validateShareSnapshotInput` içinde olduğundan bu sadece
 * erken 413 için kaba bir üst sınırdır.
 */
function countVideoDataUrlBytes(raw: string): number {
  let total = 0;
  const pattern = /data:video\/(?:mp4|webm);base64,[a-z0-9+/=]+/gi;
  for (const match of raw.matchAll(pattern)) {
    total += match[0].length;
  }
  return total;
}
