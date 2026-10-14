import { NextResponse } from "next/server";

import { NO_STORE, authorizeBackupOwner, backupErrorResponse, createBackupEngine, engineUnavailable, readConfirmation } from "@/lib/backup/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Ayrıntılar: iş kaydı + (dosya varsa) manifest özeti. Dosya yolu dönmez. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const owner = await authorizeBackupOwner(request);
  if (!owner.ok) return owner.response;
  const engine = createBackupEngine();
  if (!engine) return engineUnavailable();
  const { id } = await params;
  try {
    return NextResponse.json(await engine.details(id), { headers: NO_STORE });
  } catch (error) {
    return backupErrorResponse(error, "details");
  }
}

/** Silme: yalnız yedek kimliğiyle, açık onayla (`{ "confirm": true }`). */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const owner = await authorizeBackupOwner(request);
  if (!owner.ok) return owner.response;
  if (!(await readConfirmation(request))) return NextResponse.json({ error: "Silme işlemi için onay gerekli." }, { status: 400, headers: NO_STORE });
  const engine = createBackupEngine();
  if (!engine) return engineUnavailable();
  const { id } = await params;
  try {
    await engine.deleteBackup(id, owner.userId);
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  } catch (error) {
    return backupErrorResponse(error, "delete");
  }
}
