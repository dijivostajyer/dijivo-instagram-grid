import { NextResponse } from "next/server";

import { CalendarAccessError } from "@/lib/calendar-store";
import { assertCalendarScope, assertPostInBrand, authenticateCalendarRequest } from "@/lib/calendar-authz";
import { validateCalendarPatch } from "@/lib/calendar-utils";
import { getCalendarStore } from "../../_store";

function notConfigured(): NextResponse {
  return NextResponse.json(
    { error: "Supabase takvim yapılandırması eksik." },
    { status: 503 },
  );
}

function clientError(message: string, status: 400 | 404): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const store = getCalendarStore();
  if (!store) return notConfigured();
  const auth = await authenticateCalendarRequest(request);
  if (!auth.ok) return auth.response;
  const { searchParams } = new URL(request.url);
  const brandId = searchParams.get("brandId") ?? "";
  if (!brandId.trim()) {
    return clientError("Marka bilgisi gerekli.", 400);
  }
  // Kayıt yalnızca yetkili markanın kapsamında güncellenir (sürücü id + brand_id ile süzer).
  const denied = await assertCalendarScope(auth.userId, { brandId });
  if (denied) return denied;
  const { id } = await params;
  try {
    // Geçersiz JSON gövdesi 500 değil kontrollü 400 döner.
    const parsed: unknown = await request.json().catch(() => undefined);
    if (parsed === undefined) return clientError("Geçersiz istek gövdesi.", 400);
    const patch =
      typeof parsed === "object" && parsed !== null
        ? (parsed as Record<string, unknown>)
        : {};
    const error = validateCalendarPatch({
      postId: patch.postId,
      title: patch.title === undefined ? undefined : String(patch.title),
      scheduledAt: patch.scheduledAt === undefined ? undefined : String(patch.scheduledAt),
      status: patch.status === undefined ? undefined : (patch.status as never),
      itemType: patch.itemType === undefined ? undefined : (patch.itemType as never),
    });
    if (error) return clientError(error, 400);
    // Gönderi bağlantısı değiştiriliyorsa yeni gönderi bu markaya ve kullanıcıya ait olmalı.
    if (typeof patch.postId === "string" && patch.postId.trim() !== "") {
      const postDenied = await assertPostInBrand(auth.userId, brandId, patch.postId);
      if (postDenied) return postDenied;
    }
    const item = await store.update(id, patch as never, brandId);
    return NextResponse.json({ item });
  } catch (error) {
    console.error("[calendar] Kayıt güncellenemedi:", error instanceof Error ? error.message : error);
    if (error instanceof CalendarAccessError) {
      const status = error.message.includes("bulunamadı") ? 404 : 400;
      return clientError(error.message, status);
    }
    return NextResponse.json(
      { error: "Takvim kaydı güncellenemedi. Lütfen tekrar deneyin." },
      { status: 500 },
    );
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const store = getCalendarStore();
  if (!store) return notConfigured();
  const auth = await authenticateCalendarRequest(request);
  if (!auth.ok) return auth.response;
  const { searchParams } = new URL(request.url);
  const brandId = searchParams.get("brandId") ?? "";
  if (!brandId.trim()) {
    return clientError("Marka bilgisi gerekli.", 400);
  }
  const denied = await assertCalendarScope(auth.userId, { brandId });
  if (denied) return denied;
  const { id } = await params;
  try {
    await store.remove(id, brandId);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error("[calendar] Kayıt silinemedi:", error instanceof Error ? error.message : error);
    if (error instanceof CalendarAccessError) {
      const status = error.message.includes("bulunamadı") ? 404 : 400;
      return clientError(error.message, status);
    }
    return NextResponse.json(
      { error: "Takvim kaydı silinemedi. Lütfen tekrar deneyin." },
      { status: 500 },
    );
  }
}
