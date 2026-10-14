import { NextResponse } from "next/server";

import { handleMarkAllRead } from "@/lib/feedback-center-server";
import { SupabaseFeedbackCenterDriver } from "@/lib/feedback-center-supabase";
import { authenticateRequest } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

/** "Tümünü Okundu Yap": yalnız açık kullanıcı eylemiyle, yalnız kendi kayıtları. */
export async function POST(request: Request) {
  const user = await authenticateRequest(request);
  if (!user.ok) return NextResponse.json({ error: user.error }, { status: user.status });
  try {
    const result = await handleMarkAllRead(user.userId, new SupabaseFeedbackCenterDriver());
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    console.error("[feedback-notifications]", { step: "read_all_route", error: error instanceof Error ? error.message : "bilinmeyen hata" });
    return NextResponse.json({ error: "Bildirimler okundu yapılamadı." }, { status: 500 });
  }
}
