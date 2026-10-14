import { NextResponse } from "next/server";

import { getFeedbackCenterDetail, handleWorkflowUpdate } from "@/lib/feedback-center-server";
import { SupabaseFeedbackCenterDriver } from "@/lib/feedback-center-supabase";
import { authenticateRequest } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

/** Detay: geri bildirim + aynı hedefin geçmişi + iç durum olayları. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticateRequest(request);
  if (!user.ok) return NextResponse.json({ error: user.error }, { status: user.status });
  const { id } = await params;
  try {
    const detail = await getFeedbackCenterDetail(user.userId, id, new SupabaseFeedbackCenterDriver());
    if (!detail) return NextResponse.json({ error: "Geri dönüş bulunamadı." }, { status: 404 });
    return NextResponse.json(detail, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[feedback-center]", { step: "detail_route", error: error instanceof Error ? error.message : "bilinmeyen hata" });
    return NextResponse.json({ error: "Geri dönüş yüklenemedi." }, { status: 500 });
  }
}

/** Ekip içi iş akışı durumu (müşteri eylemi değişmez). */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticateRequest(request);
  if (!user.ok) return NextResponse.json({ error: user.error }, { status: user.status });
  const { id } = await params;
  try {
    const body: unknown = await request.json().catch(() => null);
    const result = await handleWorkflowUpdate(user.userId, id, body, new SupabaseFeedbackCenterDriver());
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    console.error("[feedback-center]", { step: "workflow_route", error: error instanceof Error ? error.message : "bilinmeyen hata" });
    return NextResponse.json({ error: "Durum güncellenemedi." }, { status: 500 });
  }
}
