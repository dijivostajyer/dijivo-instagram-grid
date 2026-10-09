import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

function adminClient() {
  const url = process.env.SUPABASE_URL?.trim();
  const secret = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!url || !secret) return null;
  return createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
}

function logFailure(step: string, error: { code?: string; message?: string; name?: string } | null) {
  console.error("[workspace/clear-all]", {
    step,
    errorName: error?.name ?? "SupabaseError",
    errorCode: error?.code,
    error: error?.message ?? "Bilinmeyen hata",
  });
}

async function authenticate(request: Request, client: SupabaseClient): Promise<string | null> {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data, error } = await client.auth.getUser(token);
  return error || !data.user ? null : data.user.id;
}

/** Storage API klasörleri ayrı öğe olarak döndürdüğü için tüm alt nesneleri toplar. */
async function listFilesRecursively(client: SupabaseClient, bucket: string, prefix: string): Promise<string[]> {
  const { data, error } = await client.storage.from(bucket).list(prefix, { limit: 1_000 });
  if (error) throw error;
  const files: string[] = [];
  for (const entry of data ?? []) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.id) files.push(path);
    else files.push(...await listFilesRecursively(client, bucket, path));
  }
  return files;
}

async function removeFiles(client: SupabaseClient, bucket: string, paths: string[], step: string) {
  for (let offset = 0; offset < paths.length; offset += 100) {
    const { error } = await client.storage.from(bucket).remove(paths.slice(offset, offset + 100));
    if (error) {
      logFailure(step, error);
      throw new Error("Storage nesneleri silinemedi.");
    }
  }
}

export async function POST(request: NextRequest) {
  const client = adminClient();
  if (!client) return NextResponse.json({ error: "Server Supabase yapılandırması eksik." }, { status: 503 });

  try {
    const userId = await authenticate(request, client);
    if (!userId) return NextResponse.json({ error: "Oturum doğrulanamadı." }, { status: 401 });

    // Snapshot şemasında owner_id yoktur. Tek hesaplı uygulamada global share
    // temizliği yalnız bootstrap sahibi tarafından yapılabilir.
    const { data: bootstrap, error: bootstrapError } = await client
      .from("workspace_bootstrap").select("owner_id").eq("id", true).maybeSingle();
    if (bootstrapError) {
      logFailure("verify_bootstrap_owner", bootstrapError);
      return NextResponse.json({ error: "Temizleme yetkisi doğrulanamadı." }, { status: 500 });
    }
    if (!bootstrap?.owner_id || bootstrap.owner_id !== userId) {
      return NextResponse.json({ error: "Bu işlem yalnız çalışma alanı sahibi tarafından yapılabilir." }, { status: 403 });
    }

    const [brandsResult, sharesResult] = await Promise.all([
      client.from("workspace_brands").select("id").eq("user_id", userId),
      client.from("share_snapshots").select("token"),
    ]);
    if (brandsResult.error || sharesResult.error) {
      logFailure("read_cleanup_scope", brandsResult.error ?? sharesResult.error);
      return NextResponse.json({ error: "Temizlenecek veriler okunamadı." }, { status: 500 });
    }

    const brandIds = (brandsResult.data ?? []).map((row) => String(row.id));
    const shareTokens = (sharesResult.data ?? []).map((row) => String(row.token));
    const workspaceBucket = process.env.SUPABASE_WORKSPACE_MEDIA_BUCKET ?? "workspace-media";
    const shareBucket = process.env.SUPABASE_SHARE_BUCKET ?? "share-images";
    const shareMediaBucket = process.env.SUPABASE_SHARE_MEDIA_BUCKET ?? "share-media";

    // Snapshot'lar silinmeden önce Storage path'leri token bazında toplanır.
    const [workspaceFiles, shareImageFiles, shareMediaFiles] = await Promise.all([
      listFilesRecursively(client, workspaceBucket, userId),
      Promise.all(shareTokens.map((token) => listFilesRecursively(client, shareBucket, `shares/${token}`))).then((items) => items.flat()),
      Promise.all(shareTokens.map((token) => listFilesRecursively(client, shareMediaBucket, `media/${token}`))).then((items) => items.flat()),
    ]);
    await Promise.all([
      removeFiles(client, workspaceBucket, workspaceFiles, "remove_workspace_media"),
      removeFiles(client, shareBucket, shareImageFiles, "remove_share_images"),
      removeFiles(client, shareMediaBucket, shareMediaFiles, "remove_share_media"),
    ]);

    // calendar_items user_id taşımaz; marka kimlikleri kullanıcı kapsamıdır.
    if (brandIds.length > 0) {
      const { error: calendarError } = await client.from("calendar_items").delete().in("brand_id", brandIds);
      if (calendarError) {
        logFailure("delete_calendar_items", calendarError);
        return NextResponse.json({ error: "Takvim verileri silinemedi." }, { status: 500 });
      }
      const { error: subscriptionsError } = await client.from("push_subscriptions").delete().in("brand_id", brandIds);
      if (subscriptionsError) {
        logFailure("delete_push_subscriptions", subscriptionsError);
        return NextResponse.json({ error: "Takvim abonelikleri silinemedi." }, { status: 500 });
      }
    }

    const deletionResults = await Promise.all([
      client.from("workspace_prefs").delete().eq("user_id", userId),
      client.from("workspace_highlights").delete().eq("user_id", userId),
      client.from("workspace_posts").delete().eq("user_id", userId),
      client.from("workspace_projects").delete().eq("user_id", userId),
      client.from("workspace_brands").delete().eq("user_id", userId),
      client.from("share_snapshots").delete(),
    ]);
    const failed = deletionResults.find((result) => result.error)?.error;
    if (failed) {
      logFailure("delete_workspace_data", failed);
      return NextResponse.json({ error: "Çalışma alanı verileri silinemedi." }, { status: 500 });
    }

    // KORUNANLAR: auth.users, workspace_bootstrap, schema/RLS/bucket/migration tanımları.
    return NextResponse.json({ ok: true });
  } catch (error) {
    logFailure("clear_all", error instanceof Error ? error : null);
    return NextResponse.json({ error: "Veri temizleme başarısız." }, { status: 500 });
  }
}
