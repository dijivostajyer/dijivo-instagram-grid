import { NextResponse } from "next/server";

import { CalendarAccessError } from "@/lib/calendar-store";
import { validateCalendarInput } from "@/lib/calendar-utils";
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
  const projectId = searchParams.get("projectId") ?? "";
  if (!brandId.trim() || !projectId.trim()) {
    return NextResponse.json(
      { error: "Marka ve aylık plan bilgisi gerekli." },
      { status: 400 },
    );
  }
  try {
    const items = await store.list(brandId, projectId);
    return NextResponse.json({ items });
  } catch (error) {
    console.error("[calendar] Kayıtlar okunamadı:", error instanceof Error ? error.message : error);
    return NextResponse.json(
      { error: "Takvim kayıtları okunamadı. Lütfen tekrar deneyin." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const store = getCalendarStore();
  if (!store) return notConfigured();
  try {
    const parsed: unknown = await request.json();
    if (typeof parsed !== "object" || parsed === null) {
      return NextResponse.json({ error: "Geçersiz istek." }, { status: 400 });
    }
    const input = parsed as Record<string, unknown>;
    // §38: sunucu tarafında tekrar doğrulanır.
    const error = validateCalendarInput({
      brandId: String(input.brandId ?? ""),
      projectId: String(input.projectId ?? ""),
      postId: input.postId === undefined || input.postId === null ? null : String(input.postId),
      itemType: String(input.itemType ?? "") as never,
      title: String(input.title ?? ""),
      description: String(input.description ?? ""),
      scheduledAt: String(input.scheduledAt ?? ""),
      status: String(input.status ?? "") as never,
      checklist: Array.isArray(input.checklist) ? (input.checklist as never) : [],
    });
    if (error) {
      return NextResponse.json({ error }, { status: 400 });
    }
    const item = await store.create({
      brandId: String(input.brandId),
      projectId: String(input.projectId),
      postId: input.postId === undefined || input.postId === null ? null : String(input.postId),
      itemType: input.itemType as never,
      title: String(input.title),
      description: String(input.description ?? ""),
      scheduledAt: String(input.scheduledAt),
      status: input.status as never,
      checklist: Array.isArray(input.checklist) ? (input.checklist as never) : [],
    });
    return NextResponse.json({ item }, { status: 201 });
  } catch (error) {
    console.error("[calendar] Kayıt oluşturulamadı:", error instanceof Error ? error.message : error);
    if (error instanceof CalendarAccessError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: "Takvim kaydı oluşturulamadı. Lütfen tekrar deneyin." },
      { status: 500 },
    );
  }
}
