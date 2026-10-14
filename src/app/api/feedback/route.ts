import { NextResponse } from "next/server";

import { parseFeedbackListQuery } from "@/lib/feedback-center";
import { listFeedbackCenter } from "@/lib/feedback-center-server";
import { SupabaseFeedbackCenterDriver } from "@/lib/feedback-center-supabase";
import { authenticateRequest } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

/** Geri Dönüşler listesi: yalnız oturumdaki kullanıcının geri bildirimleri. */
export async function GET(request: Request) {
  const user = await authenticateRequest(request);
  if (!user.ok) return NextResponse.json({ error: user.error }, { status: user.status });
  try {
    const query = parseFeedbackListQuery(new URL(request.url).searchParams);
    const result = await listFeedbackCenter(user.userId, query, new SupabaseFeedbackCenterDriver());
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[feedback-center]", { step: "list_route", error: error instanceof Error ? error.message : "bilinmeyen hata" });
    return NextResponse.json({ error: "Geri dönüşler yüklenemedi." }, { status: 500 });
  }
}
