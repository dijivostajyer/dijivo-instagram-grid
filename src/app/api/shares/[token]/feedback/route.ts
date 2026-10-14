import { NextResponse } from "next/server";

import { createRateLimiter } from "@/lib/rate-limit";
import { handleFeedbackGet, handleFeedbackPost } from "@/lib/share-feedback-api";
import { getShareFeedbackStore } from "@/lib/share-feedback-store";
import { getShareStore } from "@/lib/share-store";

export const dynamic = "force-dynamic";

// IP + paylaşım başına: 10 dakikada en fazla 20 geri bildirim (süreç içi).
const rateLimiter = createRateLimiter({ max: 20, windowMs: 10 * 60 * 1000 });

/** Müşteri geri bildirimi: login gerekmez, geçerli paylaşım tokenı gerekir. */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  try {
    const result = await handleFeedbackPost(request, token, {
      shareStore: getShareStore(),
      feedbackStore: getShareFeedbackStore(),
      rateLimiter,
    });
    return NextResponse.json(result.body, { status: result.status, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[share-feedback]", { step: "post", error: error instanceof Error ? error.message : "bilinmeyen hata" });
    return NextResponse.json({ error: "Geri bildirim kaydedilemedi. Lütfen tekrar deneyin.", code: "FEEDBACK_SAVE_FAILED" }, { status: 500 });
  }
}

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  try {
    const result = await handleFeedbackGet(token, { shareStore: getShareStore(), feedbackStore: getShareFeedbackStore() });
    return NextResponse.json(result.body, { status: result.status, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[share-feedback]", { step: "get", error: error instanceof Error ? error.message : "bilinmeyen hata" });
    return NextResponse.json({ error: "Geri bildirimler okunamadı.", code: "FEEDBACK_READ_FAILED" }, { status: 500 });
  }
}
