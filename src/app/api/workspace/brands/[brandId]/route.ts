import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

function client() { const url = process.env.SUPABASE_URL?.trim(); const secret = process.env.SUPABASE_SECRET_KEY?.trim(); return url && secret ? createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } }) : null; }
async function files(db: NonNullable<ReturnType<typeof client>>, bucket: string, prefix: string): Promise<string[]> { const { data, error } = await db.storage.from(bucket).list(prefix, { limit: 1000 }); if (error) throw error; return (await Promise.all((data ?? []).map((entry) => { const path = `${prefix}/${entry.name}`; return entry.id ? [path] : files(db, bucket, path); }))).flat(); }

export async function DELETE(request: Request, { params }: { params: Promise<{ brandId: string }> }) {
  const db = client(); const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!db || !token) return NextResponse.json({ error: "Markayı silmek için giriş yapın." }, { status: 401 });
  const { data: auth, error: authError } = await db.auth.getUser(token);
  if (authError || !auth.user) return NextResponse.json({ error: "Markayı silmek için giriş yapın." }, { status: 401 });
  const { brandId } = await params;
  try {
    const { data: brand, error: brandError } = await db.from("workspace_brands").select("id").eq("id", brandId).eq("user_id", auth.user.id).maybeSingle();
    if (brandError || !brand) return NextResponse.json({ error: "Marka bulunamadı." }, { status: 404 });
    const bucket = process.env.SUPABASE_WORKSPACE_MEDIA_BUCKET ?? "workspace-media";
    const paths = await files(db, bucket, `${auth.user.id}/${brandId}`);
    if (paths.length) { const { error } = await db.storage.from(bucket).remove(paths); if (error) throw error; }
    const calendar = await db.from("calendar_items").delete().eq("brand_id", brandId); if (calendar.error) throw calendar.error;
    const results = await Promise.all([db.from("workspace_highlights").delete().eq("user_id", auth.user.id).eq("brand_id", brandId), db.from("workspace_posts").delete().eq("user_id", auth.user.id).eq("brand_id", brandId), db.from("workspace_projects").delete().eq("user_id", auth.user.id).eq("brand_id", brandId), db.from("workspace_brands").delete().eq("user_id", auth.user.id).eq("id", brandId)]);
    const failed = results.find((result) => result.error)?.error; if (failed) throw failed;
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[workspace/delete-brand]", { step: "delete_brand", errorName: error instanceof Error ? error.name : "UnknownError", error: error instanceof Error ? error.message : "Bilinmeyen hata" });
    return NextResponse.json({ error: "Marka ve bağlı veriler silinemedi." }, { status: 500 });
  }
}
