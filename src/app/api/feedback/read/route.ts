import { NextResponse } from "next/server";

import { handleMarkRead } from "@/lib/feedback-center-server";
import { SupabaseFeedbackCenterDriver } from "@/lib/feedback-center-supabase";
import { authenticateRequest } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

/** Detayda görülen geri bildirimleri okundu yapar (Faz 5 rozeti için). */
export async function POST(request: Request) {
  const user = await authenticateRequest(request);
  if (!user.ok) return NextResponse.json({ error: user.error }, { status: user.status });
  try {
    const body: unknown = await request.json().catch(() => null);
    const result = await handleMarkRead(user.userId, body, new SupabaseFeedbackCenterDriver());
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    console.error("[feedback-center]", { step: "read_route", error: error instanceof Error ? error.message : "bilinmeyen hata" });
    return NextResponse.json({ error: "Okundu bilgisi kaydedilemedi." }, { status: 500 });
  }
}
