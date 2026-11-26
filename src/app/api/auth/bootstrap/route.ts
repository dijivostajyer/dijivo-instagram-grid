import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

function adminClient() {
  const url = process.env.SUPABASE_URL?.trim();
  const secret = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!url || !secret) return null;
  return createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function hasExistingUser(client: NonNullable<ReturnType<typeof adminClient>>) {
  const { data, error } = await client.auth.admin.listUsers({ page: 1, perPage: 1 });
  if (error) throw error;
  return data.users.length > 0;
}

/**
 * Hedef proje korumasi: bootstrap yalnizca EXPECTED_SUPABASE_PROJECT_REF ile belirtilen projeye
 * karsi calisir. Ref eksik/gecersizse, SUPABASE_URL `<ref>.supabase.co` degilse veya
 * NEXT_PUBLIC_SUPABASE_URL ayni host'a isaret etmiyorsa istek 503 ile durdurulur (fail-closed).
 * Yanitlarda ve loglarda yalnizca neden kodu yer alir; anahtar/URL degeri yazilmaz.
 */
const PROJECT_REF_PATTERN = /^[a-z0-9]{20}$/;

function projectHost(value: string | undefined): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
  if (url.pathname !== "/" || url.search || url.hash) return null;
  return url.hostname;
}

function targetGuard(): NextResponse | null {
  const reason = (() => {
    const ref = process.env.EXPECTED_SUPABASE_PROJECT_REF?.trim();
    if (!ref) return "expected_ref_missing";
    if (!PROJECT_REF_PATTERN.test(ref)) return "expected_ref_invalid";
    const serverHost = projectHost(process.env.SUPABASE_URL);
    if (!serverHost) return "server_url_invalid";
    if (serverHost !== `${ref}.supabase.co`) return "server_url_ref_mismatch";
    const publicHost = projectHost(process.env.NEXT_PUBLIC_SUPABASE_URL);
    if (!publicHost) return "public_url_invalid";
    if (publicHost !== serverHost) return "public_url_mismatch";
    return null;
  })();
  if (!reason) return null;
  console.error(`[auth/bootstrap] Hedef proje korumasi istegi durdurdu: ${reason}`);
  return NextResponse.json({ error: "Bootstrap hedef proje korumasi nedeniyle devre disi." }, { status: 503 });
}

export async function GET() {
  const blocked = targetGuard();
  if (blocked) return NextResponse.json({ canBootstrap: false }, { status: blocked.status });
  try {
    const client = adminClient();
    if (!client) return NextResponse.json({ canBootstrap: false }, { status: 503 });
    return NextResponse.json({ canBootstrap: !(await hasExistingUser(client)) });
  } catch (error) {
    console.error("[auth/bootstrap] Durum okunamadı.", { errorName: error instanceof Error ? error.name : "UnknownError" });
    return NextResponse.json({ canBootstrap: false }, { status: 500 });
  }
}

type AdminClient = NonNullable<ReturnType<typeof adminClient>>;

const OWNER_RECORD_ATTEMPTS = 3;

/** Günlüklere yalnız hata ADI yazılır (ileti/ayrıntı, şifre, anahtar ya da yığın izi yazılmaz). */
function errorName(error: unknown): string {
  return error instanceof Error ? error.name : "UnknownError";
}

/**
 * Kilit satırını yalnızca SAHİBİ BOŞSA bırakır (`owner_id IS NULL`); sahibi dolu bir kilit hiçbir yolda silinmez.
 * "released": 1 satır silindi · "none": silinecek sahipsiz kilit yok (yok ya da sahibi dolu; dokunulmadı) ·
 * "error": sorgu hata verdi ya da istisna attı (kilidin durumu belirsiz).
 */
async function releaseLock(client: AdminClient): Promise<"released" | "none" | "error"> {
  try {
    const { data, error } = await client.from("workspace_bootstrap").delete().eq("id", true).is("owner_id", null).select("id");
    if (error) {
      console.error("[auth/bootstrap] Kilit bırakılamadı.", { errorCode: error.code });
      return "error";
    }
    return data && data.length > 0 ? "released" : "none";
  } catch (error) {
    console.error("[auth/bootstrap] Kilit bırakılırken istisna.", { errorName: errorName(error) });
    return "error";
  }
}

/**
 * Yeni kullanıcının kimliğini kilit satırına sahip olarak yazar. Yalnızca `owner_id` hâlâ
 * boşsa yazar (başka bir sahibi ezmez) ve tam bir satırın güncellendiğini doğrular.
 * "ok": yazıldı · "conflict": kilit yok ya da sahip zaten dolu · "error": veritabanı hatası/istisna (yeniden denendi).
 */
async function recordOwner(client: AdminClient, userId: string): Promise<"ok" | "conflict" | "error"> {
  for (let attempt = 1; attempt <= OWNER_RECORD_ATTEMPTS; attempt += 1) {
    try {
      const { data, error } = await client
        .from("workspace_bootstrap")
        .update({ owner_id: userId })
        .eq("id", true)
        .is("owner_id", null)
        .select("id");
      if (!error) return data?.length === 1 ? "ok" : "conflict";
      console.error("[auth/bootstrap] Sahiplik kaydı başarısız.", { attempt, errorCode: error.code });
    } catch (error) {
      console.error("[auth/bootstrap] Sahiplik kaydı istisna attı.", { attempt, errorName: errorName(error) });
    }
  }
  return "error";
}

/** Yalnız BU istekte oluşturulan kullanıcıyı siler. true: silindi · false: silinemedi/belirsiz (hata ya da istisna). */
async function deleteCreatedUser(client: AdminClient, userId: string): Promise<boolean> {
  try {
    const { error } = await client.auth.admin.deleteUser(userId);
    if (!error) return true;
    console.error("[auth/bootstrap] Telafi: kullanıcı silinemedi.", { userId, errorCode: (error as { code?: string }).code });
    return false;
  } catch (error) {
    console.error("[auth/bootstrap] Telafi: kullanıcı silinirken istisna.", { userId, errorName: errorName(error) });
    return false;
  }
}

const SUPPORT = "Lütfen sistem yöneticisine başvurun.";
/** createUser hatasında istemciye dönen sabit, sağlayıcıdan bağımsız mesaj. */
const CREATE_USER_FAILED_MESSAGE = "Hesap oluşturulamadı. E-posta ve şifrenizi kontrol edip tekrar deneyin.";

export async function POST(request: NextRequest) {
  const blocked = targetGuard();
  if (blocked) return blocked;
  const client = adminClient();
  if (!client) return NextResponse.json({ error: "İlk hesap kurulumu yapılandırılmamış." }, { status: 503 });
  const body = await request.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  if (!email || password.length < 6) return NextResponse.json({ error: "Geçerli e-posta ve en az 6 karakter şifre gerekli." }, { status: 400 });

  try {
    if (await hasExistingUser(client)) return NextResponse.json({ error: "İlk hesap zaten oluşturuldu." }, { status: 409 });
    // Kilit satırı birincil anahtardır (id boolean pk): eşzamanlı isteklerden yalnızca biri ekleyebilir.
    const { error: lockError } = await client.from("workspace_bootstrap").insert({ id: true });
    if (lockError) return NextResponse.json({ error: "İlk hesap kurulumu zaten başlatıldı." }, { status: 409 });

    const { data, error } = await client.auth.admin.createUser({ email, password, email_confirm: true });
    if (error || !data.user) {
      // (Belirsiz createUser zaman aşımı kurtarması bu sürümde YOK: Paket B.)
      // Sağlayıcının ham hata iletisi istemciye DÖNMEZ; yalnız güvenli tanılama alanları (kod/durum) loglanır.
      const failure = (error ?? {}) as { code?: string; status?: number };
      console.error("[auth/bootstrap] Kullanıcı oluşturulamadı.", { errorCode: failure.code, status: failure.status });
      if ((await releaseLock(client)) === "error") {
        return NextResponse.json({ error: `İlk hesap oluşturulamadı ve kurulum kilidi temizlenemedi. ${SUPPORT}`, code: "BOOTSTRAP_LOCK_STUCK" }, { status: 500 });
      }
      return NextResponse.json({ error: CREATE_USER_FAILED_MESSAGE }, { status: 400 });
    }

    const createdUserId = data.user.id;
    const recorded = await recordOwner(client, createdUserId);
    if (recorded === "ok") return NextResponse.json({ ok: true }, { status: 201 });

    // Sahiplik kaydedilemedi: kullanıcı oluştu ama çalışma alanının sahibi yok. Başarı DÖNÜLMEZ.
    // Telafi adımları ayrı ayrı korunur; bir adımın istisnası diğerini maskelemez/atlatmaz.
    console.error("[auth/bootstrap] Sahiplik kaydedilemedi; oluşturulan kullanıcı geri alınıyor.", { reason: recorded });
    if (!(await deleteCreatedUser(client, createdUserId))) {
      // Kullanıcı kaldı veya durumu belirsiz: kilide DOKUNULMAZ (sahipliği bilinmeyen bir hesap varken
      // yeni bootstrap'e izin verilmez; kilit bırakılırsa ikinci bir hesap oluşabilirdi).
      return NextResponse.json(
        { error: `Hesap oluşturuldu ancak çalışma alanı sahipliği kaydedilemedi ve otomatik temizlenemedi. ${SUPPORT}`, code: "BOOTSTRAP_OWNER_UNRECOVERED" },
        { status: 500 },
      );
    }
    if (recorded === "conflict") {
      // Kilit yok ya da başkasının sahipliği var: kendi oluşturmadığımız bir kilide dokunulmaz.
      return NextResponse.json({ error: "İlk hesap kurulumu başka bir işlemle çakıştı. Lütfen durumu kontrol edip tekrar deneyin.", code: "BOOTSTRAP_CONFLICT_ROLLED_BACK" }, { status: 500 });
    }
    if ((await releaseLock(client)) === "error") {
      return NextResponse.json({ error: `İlk hesap kurulumu tamamlanamadı ve kurulum kilidi temizlenemedi. ${SUPPORT}`, code: "BOOTSTRAP_LOCK_STUCK" }, { status: 500 });
    }
    return NextResponse.json({ error: "İlk hesap kurulumu tamamlanamadı. Lütfen tekrar deneyin.", code: "BOOTSTRAP_ROLLED_BACK" }, { status: 500 });
  } catch (error) {
    console.error("[auth/bootstrap] İlk hesap oluşturulamadı.", { errorName: errorName(error) });
    return NextResponse.json({ error: "İlk hesap oluşturulamadı." }, { status: 500 });
  }
}
