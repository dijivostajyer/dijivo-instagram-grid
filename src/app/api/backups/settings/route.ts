import { NextResponse } from "next/server";

import { NO_STORE, authorizeBackupOwner, backupErrorResponse, createBackupEngine, engineUnavailable } from "@/lib/backup/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Otomatik yedek aç/kapa, periyot (en az 15 dk) ve saklama politikası. */
export async function PATCH(request: Request) {
  const owner = await authorizeBackupOwner(request);
  if (!owner.ok) return owner.response;
  const engine = createBackupEngine();
  if (!engine) return engineUnavailable();
  try {
    const body: unknown = await request.json().catch(() => null);
    const settings = await engine.updateSettings(body, owner.userId);
    return NextResponse.json({ settings }, { headers: NO_STORE });
  } catch (error) {
    return backupErrorResponse(error, "settings");
  }
}
