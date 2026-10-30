import { NextResponse } from "next/server";

import {
  describeInvalidShareInput,
  isWorkspaceMediaShareRef,
  validateShareCreateInput,
  MAX_SHARE_REQUEST_BYTES,
} from "@/lib/share";
import { getShareStore } from "@/lib/share-store";
import { createClient } from "@supabase/supabase-js";

type AuthenticationResult = { ok: true; userId: string } | { ok: false; reason: string };

async function authenticate(request: Request): Promise<AuthenticationResult> {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const url = process.env.SUPABASE_URL?.trim();
  const secret = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!token) return { ok: false, reason: "Authorization bearer token yok." };
  if (!url || !secret) return { ok: false, reason: "Server Supabase yapılandırması eksik." };
  const client = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) return { ok: false, reason: `Auth token doğrulanamadı: ${error?.message ?? "kullanıcı yok"}` };
  return { ok: true, userId: data.user.id };
}

/** Girdideki tüm `storage:workspace-media/…` referansları (marka, öne çıkan, hücre, story). */
function collectWorkspaceMediaRefs(input: import("@/lib/share").ShareSnapshotInput): string[] {
  const values = [
    input.brand.profileImageUrl,
    ...(input.brand.highlights ?? []).map((highlight) => highlight.imageUrl),
    ...input.cells.flatMap((cell) => [cell.imageUrl, cell.videoUrl, cell.coverImageUrl]),
    ...(input.stories ?? []).map((story) => story.mediaUrl),
  ];
  return values.filter((value): value is string => typeof value === "string" && isWorkspaceMediaShareRef(value));
}

/**
 * Geri bildirim kayıtları snapshot'taki marka/plan ile ilişkilendirilir.
 * İstemcinin gönderdiği kimliklere güvenilmez: yalnız oturumdaki
 * kullanıcıya ait marka ve o markanın planı kabul edilir; doğrulanamayan
 * ilişki sessizce düşülür (paylaşım yine oluşturulur, geri bildirim
 * markasız kaydedilir).
 */
async function verifyShareContext(
  input: import("@/lib/share").ShareSnapshotInput,
  userId: string,
): Promise<import("@/lib/share").ShareSnapshotInput> {
  const { context, ...rest } = input;
  if (!context?.brandId) return rest;
  const url = process.env.SUPABASE_URL?.trim();
  const secret = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!url || !secret) return rest;
  const client = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: brand, error: brandError } = await client
    .from("workspace_brands").select("id").eq("id", context.brandId).eq("user_id", userId).maybeSingle();
  if (brandError || !brand) {
    console.warn("[share] context markası doğrulanamadı; ilişki düşüldü", { brandError: brandError?.message });
    return rest;
  }
  if (!context.projectId) return { ...rest, context: { brandId: context.brandId } };
  const { data: project, error: projectError } = await client
    .from("workspace_projects").select("id").eq("id", context.projectId).eq("brand_id", context.brandId).eq("user_id", userId).maybeSingle();
  if (projectError || !project) {
    console.warn("[share] context planı doğrulanamadı; yalnız marka ilişkisi tutuldu", { projectError: projectError?.message });
    return { ...rest, context: { brandId: context.brandId } };
  }
  return { ...rest, context: { brandId: context.brandId, projectId: context.projectId } };
}

export async function POST(request: Request): Promise<NextResponse> {
  const requestId = crypto.randomUUID();
  try {
    const authentication = await authenticate(request);
    if (!authentication.ok) {
      console.warn("[share] POST yetkilendirme reddedildi", { requestId, reason: authentication.reason });
      return NextResponse.json({ error: "Paylaşım oluşturmak için giriş yapın.", code: "SHARE_UNAUTHORIZED", requestId }, { status: 401 });
    }
    const raw = await request.text();
    const bodyBytes = new TextEncoder().encode(raw).byteLength;
    // Medya artık gövdede taşınmaz: kullanıcının Storage'daki dosyaları
    // `storage:workspace-media/…` referansıyla gelir ve sunucuda Storage'dan
    // Storage'a kopyalanır. Gövde yalnız metadata + küçük referanslar içerir.
    if (bodyBytes > MAX_SHARE_REQUEST_BYTES) {
      return NextResponse.json(
        { error: "Paylaşım isteği çok büyük; medya dosyaları Storage'a yüklenemediği için gövdeye gömülmüş olabilir.", code: "SHARE_PAYLOAD_TOO_LARGE", requestId },
        { status: 413 },
      );
    }
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { parsed = null; }
    const input = validateShareCreateInput(parsed);
    if (!input) {
      console.warn("[share] POST geçersiz payload", { requestId, bodyBytes, issue: describeInvalidShareInput(parsed) });
      return NextResponse.json(
        { error: "Paylaşılabilir grid bulunamadı.", code: "SHARE_INVALID_PAYLOAD", requestId },
        { status: 400 },
      );
    }
    const portableInput = await verifyShareContext(input, authentication.userId);
    if (collectWorkspaceMediaRefs(portableInput).some((value) => !value.startsWith(`storage:workspace-media/${authentication.userId}/`))) {
      console.warn("[share] POST başka kullanıcıya ait medya referansı reddedildi", { requestId });
      return NextResponse.json({ error: "Medya sahipliği doğrulanamadı.", code: "SHARE_MEDIA_FORBIDDEN", requestId }, { status: 403 });
    }
    console.info("[share] POST payload doğrulandı", { requestId, cells: portableInput.cells.length, bodyBytes, hasVideo: portableInput.cells.some((cell) => Boolean(cell.videoUrl)), stories: portableInput.stories?.length ?? 0, hasContext: Boolean(portableInput.context) });
    const snapshot = await getShareStore().create(portableInput, { ownerId: authentication.userId });
    console.info("[share] Snapshot oluşturuldu", { requestId, token: snapshot.token, cells: input.cells.length });
    return NextResponse.json({ token: snapshot.token, requestId }, { status: 201 });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "bilinmeyen hata";
    console.error("[share] Snapshot oluşturulamadı", { requestId, detail });
    const message = error instanceof Error ? error.message : "";
    // Kullanıcının düzeltebileceği hatalar açıkça iletilir; iç hatalar genel mesajda kalır.
    if (/^(Paylaşım (görseli|videosu) geçersiz|Reel için kapak görseli gerekli)/.test(message)) {
      return NextResponse.json({ error: message, code: "SHARE_MEDIA_INVALID", requestId }, { status: 422 });
    }
    const tooLarge = message.includes("çok büyük");
    return NextResponse.json(
      {
        error: tooLarge ? "Paylaşım için yüklenen dosyalar çok büyük." : "Paylaşım bağlantısı oluşturulamadı.",
        code: tooLarge ? "SHARE_PAYLOAD_TOO_LARGE" : "SHARE_CREATE_FAILED",
        requestId,
      },
      { status: tooLarge ? 413 : 500 },
    );
  }
}
