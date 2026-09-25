import { NextResponse } from "next/server";

import { validateShareSnapshotInput } from "@/lib/share";
import { MAX_SHARE_TOTAL_BYTES } from "@/lib/share";
import { getShareStore } from "@/lib/share-store";

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_SHARE_TOTAL_BYTES * 2) {
      return NextResponse.json({ error: "Paylaşım için yüklenen görseller çok büyük." }, { status: 413 });
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
      { error: message.includes("çok büyük") ? "Paylaşım için yüklenen görseller çok büyük." : "Paylaşım bağlantısı oluşturulamadı. Lütfen tekrar deneyin." },
      { status: message.includes("çok büyük") ? 413 : 500 },
    );
  }
}
