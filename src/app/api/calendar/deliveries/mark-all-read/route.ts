import { NextResponse } from "next/server";

import { getCalendarStore } from "../../_store";

/** Bildirim merkezindeki \"Tümünü okundu say\" aksiyonu (§26). */
export async function POST(request: Request): Promise<NextResponse> {
  const store = getCalendarStore();
  if (!store) {
    return NextResponse.json(
      { error: "Supabase takvim yapılandırması eksik." },
      { status: 503 },
    );
  }
  const { searchParams } = new URL(request.url);
  const brandId = searchParams.get("brandId") ?? "";
  if (!brandId.trim()) {
    return NextResponse.json(
      { error: "Marka bilgisi gerekli." },
      { status: 400 },
    );
  }
  try {
    await store.markAllRead(brandId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[calendar] Bildirimler güncellenemedi:", error instanceof Error ? error.message : error);
    return NextResponse.json(
      { error: "Bildirimler güncellenemedi. Lütfen tekrar deneyin." },
      { status: 500 },
    );
  }
}
