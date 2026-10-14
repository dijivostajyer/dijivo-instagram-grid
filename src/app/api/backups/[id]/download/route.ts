import { Readable } from "node:stream";

import { NO_STORE, authorizeBackupOwner, backupErrorResponse, createBackupEngine, engineUnavailable } from "@/lib/backup/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Yedek paketini yetkili istekle akış (stream) olarak indirir. Public URL
 * veya imzalı bağlantı üretilmez; dosya yolu istemciye hiç gönderilmez.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const owner = await authorizeBackupOwner(request);
  if (!owner.ok) return owner.response;
  const engine = createBackupEngine();
  if (!engine) return engineUnavailable();
  const { id } = await params;
  try {
    const { stream, size, fileName } = await engine.openDownload(id, owner.userId);
    return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, {
      headers: {
        ...NO_STORE,
        "Content-Type": "application/zip",
        "Content-Length": String(size),
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return backupErrorResponse(error, "download");
  }
}
