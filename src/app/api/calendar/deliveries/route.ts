import { NextResponse } from "next/server";

import { CalendarAccessError } from "@/lib/calendar-store";
import { getCalendarStore } from "../_store";

function notConfigured(): NextResponse {
  return NextResponse.json(
    { error: "Supabase takvim yapılandırması eksik." },
    { status: 503 },
  );
}

export async function GET(request: Request): Promise<NextResponse> {
  const store = getCalendarStore();
  if (!store) return notConfigured();
  const { searchParams } = new URL(request.url);
  const brandId = searchParams.get("brandId") ?? "";
  if (!brandId.trim()) {
    return NextResponse.json(
      { error: "Marka bilgisi gerekli." },
      { status: 400 },
    );
  }
  try {
    const deliveries = await store.listDeliveries(brandId);
    return NextResponse.json({ deliveries });
  } catch (error) {
    console.error("[calendar] Bildirimler okunamadı:", error instanceof Error ? error.message : error);
    return NextResponse.json(
      { error: "Bildirimler okunamadı. Lütfen tekrar deneyin." },
      { status: 500 },
    );
  }
}

/**
 * Hatırlatma teslimi (§27): (item_id, remind_at)
 * eşsizliği sayesinde aynı hatırlatma bir kez
 * teslim edilir; çift teslim 409 ile reddedilir.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const store = getCalendarStore();
  if (!store) return notConfigured();
  try {
    const parsed: unknown = await request.json();
    if (typeof parsed !== "object" || parsed === null) {
      return NextResponse.json({ error: "Geçersiz istek." }, { status: 400 });
    }
    const input = parsed as Record<string, unknown>;
    const delivery = await store.deliverReminder({
      itemId: String(input.itemId ?? ""),
      brandId: String(input.brandId ?? ""),
      channel: String(input.channel ?? "in_app") as never,
      remindAt: String(input.remindAt ?? ""),
      scheduledAt: String(input.scheduledAt ?? ""),
      title: String(input.title ?? ""),
      body: String(input.body ?? ""),
    });
    return NextResponse.json({ delivery }, { status: 201 });
  } catch (error) {
    console.error("[calendar] Hatırlatma teslim edilemedi:", error instanceof Error ? error.message : error);
    if (error instanceof CalendarAccessError) {
      const status = error.message.includes("zaten") ? 409 : 400;
      return NextResponse.json({ error: error.message }, { status });
    }
    return NextResponse.json(
      { error: "Hatırlatma kaydedilemedi. Lütfen tekrar deneyin." },
      { status: 500 },
    );
  }
}
