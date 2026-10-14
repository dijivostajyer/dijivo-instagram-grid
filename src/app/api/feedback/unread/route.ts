import { NextResponse } from "next/server";

import { getNotificationSummary } from "@/lib/feedback-center-server";
import { SupabaseFeedbackCenterDriver } from "@/lib/feedback-center-supabase";
import { authenticateRequest } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

/**
 * Bildirim rozeti ve açılır liste için hafif uç nokta: okunmamış sayısı +
 * son birkaç kayıt. Medya imzalanmaz; yalnız oturumdaki kullanıcının
 * kayıtları sayılır ve listelenir.
 */
export async function GET(request: Request) {
  const user = await authenticateRequest(request);
  if (!user.ok) return NextResponse.json({ error: user.error }, { status: user.status });
  try {
    const limit = new URL(request.url).searchParams.get("limit");
    const summary = await getNotificationSummary(user.userId, limit, new SupabaseFeedbackCenterDriver());
    return NextResponse.json(summary, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[feedback-notifications]", { step: "unread_route", error: error instanceof Error ? error.message : "bilinmeyen hata" });
    return NextResponse.json({ error: "Bildirimler yüklenemedi." }, { status: 500 });
  }
}
