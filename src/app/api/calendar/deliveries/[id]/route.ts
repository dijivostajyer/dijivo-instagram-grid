import { NextResponse } from "next/server";

import { CalendarAccessError } from "@/lib/calendar-store";
import { getCalendarStore } from "../../_store";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
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
  const { id } = await params;
  try {
    await store.markRead(id, brandId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[calendar] Bildirim güncellenemedi:", error instanceof Error ? error.message : error);
    if (error instanceof CalendarAccessError) {
      const status = error.message.includes("bulunamadı") ? 404 : 400;
      return NextResponse.json({ error: error.message }, { status });
    }
    return NextResponse.json(
      { error: "Bildirim güncellenemedi. Lütfen tekrar deneyin." },
      { status: 500 },
    );
  }
}
