/**
 * Browser-side adapter for the private `workspace-media` bucket.
 *
 * The browser never receives the service-role key.  It asks our server for a
 * short-lived signed upload/download URL and streams the Blob directly to
 * Supabase Storage.  This deliberately avoids base64/JSON payloads (which
 * are unsuitable for Reel-sized videos).
 */
const STORAGE_PREFIX = "storage:workspace-media/";
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
import { getSupabaseBrowserClient } from "./supabase-browser";

export function isWorkspaceMediaRef(value: string | undefined): value is string {
  return Boolean(value?.startsWith(STORAGE_PREFIX));
}

export function workspaceMediaPath(value: string): string {
  return value.slice(STORAGE_PREFIX.length);
}

export async function resolveWorkspaceMedia(value: string): Promise<string> {
  if (!isWorkspaceMediaRef(value)) return value;
  const db = getSupabaseBrowserClient();
  if (!db) throw new Error("Supabase Auth yapılandırılmadı.");
  const { data, error } = await db.storage.from("workspace-media").createSignedUrl(workspaceMediaPath(value), 60 * 60);
  if (error || !data) throw new Error("Özel medya bağlantısı oluşturulamadı.");
  return data.signedUrl;
}

export async function uploadWorkspaceMedia(value: string, purpose: string): Promise<string> {
  if (isWorkspaceMediaRef(value) || !value) return value;
  const blobResponse = await fetch(value);
  if (!blobResponse.ok) throw new Error("Yerel medya okunamadı.");
  const blob = await blobResponse.blob();
  if (blob.size > MAX_UPLOAD_BYTES) {
    throw new Error("Medya 100 MB sınırını aşıyor.");
  }
  const mime = blob.type || "application/octet-stream";
  const db = getSupabaseBrowserClient();
  if (!db) throw new Error("Medya yüklemek için giriş yapın.");
  const { data: userData } = await db.auth.getUser();
  const user = userData.user;
  if (!user) throw new Error("Medya yüklemek için giriş yapın.");
  const extension = mime === "image/jpeg" ? "jpg" : mime.split("/")[1] || "bin";
  const path = `${user.id}/${purpose}/${crypto.randomUUID()}.${extension}`;
  const { data: ticket, error: ticketError } = await db.storage.from("workspace-media").createSignedUploadUrl(path, { upsert: false });
  if (ticketError || !ticket) throw new Error("Medya yükleme bağlantısı oluşturulamadı.");
  const { error } = await db.storage.from("workspace-media").uploadToSignedUrl(path, ticket.token, blob, { contentType: mime, upsert: false });
  if (error) throw new Error("Medya Storage'a yüklenemedi.");
  return `${STORAGE_PREFIX}${path}`;
}
