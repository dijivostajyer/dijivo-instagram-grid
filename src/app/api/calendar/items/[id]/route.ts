import { NextResponse } from "next/server";

import { CalendarAccessError } from "@/lib/calendar-store";
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
  const { searchParams } = new URL(request.url);
  const brandId = searchParams.get("brandId") ?? "";
  if (!brandId.trim()) {
    return clientError("Marka bilgisi gerekli.", 400);
  }
  const { id } = await params;
  try {
    const parsed: unknown = await request.json();
    const patch =
      typeof parsed === "object" && parsed !== null
        ? (parsed as Record<string, unknown>)
        : {};
    const error = validateCalendarPatch({
      title: patch.title === undefined ? undefined : String(patch.title),
      scheduledAt: patch.scheduledAt === undefined ? undefined : String(patch.scheduledAt),
      status: patch.status === undefined ? undefined : (patch.status as never),
      reminderOffsetMinutes:
        patch.reminderOffsetMinutes === undefined || patch.reminderOffsetMinutes === null
          ? undefined
          : Number(patch.reminderOffsetMinutes),
      itemType: patch.itemType === undefined ? undefined : (patch.itemType as never),
    });
    if (error) return clientError(error, 400);
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
  const { searchParams } = new URL(request.url);
  const brandId = searchParams.get("brandId") ?? "";
  if (!brandId.trim()) {
    return clientError("Marka bilgisi gerekli.", 400);
  }
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
