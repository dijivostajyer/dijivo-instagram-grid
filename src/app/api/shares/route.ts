import { NextResponse } from "next/server";

import {
  validateShareSnapshotInput,
  MAX_SHARE_TOTAL_BYTES,
  MAX_SHARE_TOTAL_VIDEO_BYTES,
} from "@/lib/share";
import { getShareStore } from "@/lib/share-store";

export async function POST(request: Request): Promise<NextResponse> {
  try {
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
      return NextResponse.json(
        { error: "Paylaşılabilir grid bulunamadı." },
        { status: 400 },
      );
    }
    const snapshot = await getShareStore().create(input);
    return NextResponse.json({ token: snapshot.token }, { status: 201 });
  } catch (error) {
    console.error("[share] Snapshot oluşturulamadı:", error instanceof Error ? error.message : "bilinmeyen hata");
    const message = error instanceof Error ? error.message : "";
    return NextResponse.json(
      { error: message.includes("çok büyük") ? "Paylaşım için yüklenen dosyalar çok büyük." : "Paylaşım bağlantısı oluşturulamadı. Lütfen tekrar deneyin." },
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
