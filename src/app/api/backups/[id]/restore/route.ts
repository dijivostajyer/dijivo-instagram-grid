import { NextResponse } from "next/server";

import { NO_STORE, authorizeBackupOwner, backupErrorResponse, createBackupEngine, engineUnavailable, readConfirmation, settleInBackground } from "@/lib/backup/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Geri yükleme: açık onay (`{ "confirm": true }`) şart. Doğrulama →
 * güvenlik yedeği → medya hazırlama → tek transaction'da DB → medya
 * temizliği arka planda sürer; istemci GET /api/backups ile izler.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const owner = await authorizeBackupOwner(request);
  if (!owner.ok) return owner.response;
  if (!(await readConfirmation(request))) return NextResponse.json({ error: "Geri yükleme için onay gerekli." }, { status: 400, headers: NO_STORE });
  const engine = createBackupEngine();
  if (!engine) return engineUnavailable();
  const { id } = await params;
  try {
    const { job, completion } = await engine.startRestore(id, owner.userId);
    settleInBackground(completion);
    return NextResponse.json({ job }, { status: 202, headers: NO_STORE });
  } catch (error) {
    return backupErrorResponse(error, "restore");
  }
}
