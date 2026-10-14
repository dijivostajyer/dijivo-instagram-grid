import { NextResponse } from "next/server";

import { NO_STORE, authorizeBackupOwner, backupErrorResponse, createBackupEngine, engineUnavailable, settleInBackground } from "@/lib/backup/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Yedekleme sayfası: ayarlar, son/sonraki yedek, çalışan iş ve geçmiş. */
export async function GET(request: Request) {
  const owner = await authorizeBackupOwner(request);
  if (!owner.ok) return owner.response;
  const engine = createBackupEngine();
  if (!engine) return engineUnavailable();
  try {
    return NextResponse.json(await engine.overview(), { headers: NO_STORE });
  } catch (error) {
    return backupErrorResponse(error, "overview");
  }
}

/**
 * "Şimdi Yedekle": kilit + cooldown sunucuda denetlenir; iş kaydı oluşunca
 * 202 döner, yedek arka planda sürer (istemci GET ile ilerlemeyi izler).
 */
export async function POST(request: Request) {
  const owner = await authorizeBackupOwner(request);
  if (!owner.ok) return owner.response;
  const engine = createBackupEngine();
  if (!engine) return engineUnavailable();
  try {
    const { job, completion } = await engine.startManualBackup(owner.userId);
    settleInBackground(completion);
    return NextResponse.json({ job }, { status: 202, headers: NO_STORE });
  } catch (error) {
    return backupErrorResponse(error, "manual_backup");
  }
}
