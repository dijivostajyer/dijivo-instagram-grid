import { NextResponse } from "next/server";

import { getCalendarStore } from "../_store";

/**
 * Markanın tüm projelerindeki takvim kayıtları.
 * Hatırlatma motoru ve dashboard özetleri tarafından
 * kullanılır; yanıt her zaman brand_id filtrelidir (§23).
 */
export async function GET(request: Request): Promise<NextResponse> {
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
    const items = await store.listAll(brandId);
    return NextResponse.json({ items });
  } catch (error) {
    console.error("[calendar] Marka kayıtları okunamadı:", error instanceof Error ? error.message : error);
    return NextResponse.json(
      { error: "Takvim kayıtları okunamadı. Lütfen tekrar deneyin." },
      { status: 500 },
    );
  }
}
