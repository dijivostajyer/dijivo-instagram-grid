import { NextResponse } from "next/server";

import { CalendarAccessError } from "@/lib/calendar-store";
import { assertCalendarScope, assertPostInBrand, authenticateCalendarRequest } from "@/lib/calendar-authz";
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
  const auth = await authenticateCalendarRequest(request);
  if (!auth.ok) return auth.response;
  const { searchParams } = new URL(request.url);
  const brandId = searchParams.get("brandId") ?? "";
  const projectId = searchParams.get("projectId") ?? "";
  if (!brandId.trim() || !projectId.trim()) {
    return NextResponse.json(
      { error: "Marka ve aylık plan bilgisi gerekli." },
      { status: 400 },
    );
  }
  const denied = await assertCalendarScope(auth.userId, { brandId, projectId });
  if (denied) return denied;
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
  const auth = await authenticateCalendarRequest(request);
  if (!auth.ok) return auth.response;
  try {
    // Geçersiz JSON gövdesi 500 değil kontrollü 400 döner.
    const parsed: unknown = await request.json().catch(() => null);
    if (typeof parsed !== "object" || parsed === null) {
      return NextResponse.json({ error: "Geçersiz istek." }, { status: 400 });
    }
    const input = parsed as Record<string, unknown>;
    // postId yalnız dize ya da null/eksik olabilir; diğer türler (sayı, nesne, dizi…) String(...) ile
    // sessizce dönüştürülmeden reddedilir (PATCH ile tutarlı).
    if (input.postId !== undefined && input.postId !== null && typeof input.postId !== "string") {
      return NextResponse.json({ error: "Geçersiz gönderi bağlantısı." }, { status: 400 });
    }
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
    // Marka ve plan oturumdaki kullanıcıya ait ve birbiriyle tutarlı olmalı.
    const denied = await assertCalendarScope(auth.userId, {
      brandId: String(input.brandId),
      projectId: String(input.projectId),
    });
    if (denied) return denied;
    // Bağlanacak gönderi (varsa) bu markaya ve kullanıcıya ait olmalı; yazmadan ÖNCE doğrulanır.
    const postId = input.postId === undefined || input.postId === null ? "" : String(input.postId);
    if (postId.trim() !== "") {
      const postDenied = await assertPostInBrand(auth.userId, String(input.brandId), postId);
      if (postDenied) return postDenied;
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
