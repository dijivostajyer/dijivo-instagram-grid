import { NextResponse } from "next/server";

import { NO_STORE, authorizeBackupOwner, backupErrorResponse, createBackupEngine, engineUnavailable } from "@/lib/backup/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** ZIP + manifest + sürüm + JSON + sağlama toplamı + tablo/medya tutarlılığı. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const owner = await authorizeBackupOwner(request);
  if (!owner.ok) return owner.response;
  const engine = createBackupEngine();
  if (!engine) return engineUnavailable();
  const { id } = await params;
  try {
    return NextResponse.json(await engine.validateBackup(id), { headers: NO_STORE });
  } catch (error) {
    return backupErrorResponse(error, "validate");
  }
}
