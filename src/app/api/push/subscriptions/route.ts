/**
 * Push abonelikleri (§ background notifications).
 *
 * Abonelik gövdesi (endpoint + p256dh + auth) **yalnızca** sunucuda
 * doğrulanır ve `push_subscriptions` tablosuna yazılır. Secret'lar
 * istemci bundle'ına girmez; endpoint doğrulaması `normalizePushSubscription`
 * ile yapılır (yalnızca HTTPS, uzunluk sınırları, zorunlu anahtarlar).
 *
 * POST   → abonelik oluşturur / yeniler (upsert, endpoint benzersiz)
 * DELETE → abonelik silinir (endpoint ile)
 */

import { NextResponse } from "next/server";

import { normalizePushSubscription } from "@/lib/reminder-dispatch";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readConfig(): { url: string; secretKey: string } | null {
  const url = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secretKey) return null;
  return { url, secretKey };
}

function supabaseFetch(config: { url: string; secretKey: string }, path: string, init: RequestInit) {
  return fetch(`${config.url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: config.secretKey,
      Authorization: `Bearer ${config.secretKey}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
      ...(init.headers ?? {}),
    },
  });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Geçersiz istek gövdesi." }, { status: 400 });
  }
  if (!isRecord(body) || typeof body.brandId !== "string" || body.brandId.length === 0) {
    return NextResponse.json({ error: "brandId zorunludur." }, { status: 400 });
  }

  const subscription = normalizePushSubscription(body.subscription, request.headers.get("user-agent"));
  if (subscription === null) {
    return NextResponse.json(
      { error: "Push aboneliği geçersiz." },
      { status: 422 },
    );
  }

  const config = readConfig();
  if (config === null) {
    return NextResponse.json(
      { error: "Push aboneliği kaydedilemedi (Supabase yapılandırması eksik)." },
      { status: 503 },
    );
  }

  // Upsert: aynı endpoint ikinci kez abone olursa satır güncellenir.
  const response = await supabaseFetch(config, "push_subscriptions?on_conflict=endpoint", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({
      brand_id: body.brandId,
      endpoint: subscription.endpoint,
      p256dh: subscription.p256dh,
      auth: subscription.auth,
      user_agent: subscription.userAgent,
    }),
  });

  if (!response.ok) {
    return NextResponse.json(
      { error: "Push aboneliği kaydedilemedi." },
      { status: 502 },
    );
  }
  return NextResponse.json({ ok: true }, { status: 201 });
}

export async function DELETE(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Geçersiz istek gövdesi." }, { status: 400 });
  }
  const subscription = normalizePushSubscription(
    isRecord(body) ? body.subscription : null,
    null,
  );
  if (subscription === null) {
    return NextResponse.json({ error: "Push aboneliği geçersiz." }, { status: 422 });
  }

  const config = readConfig();
  if (config === null) {
    return NextResponse.json(
      { error: "Push aboneliği silinemedi (Supabase yapılandırması eksik)." },
      { status: 503 },
    );
  }

  const response = await supabaseFetch(
    config,
    `push_subscriptions?endpoint=eq.${encodeURIComponent(subscription.endpoint)}`,
    { method: "DELETE" },
  );
  if (!response.ok) {
    return NextResponse.json({ error: "Push aboneliği silinemedi." }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}