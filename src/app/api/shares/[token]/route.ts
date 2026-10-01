import { NextResponse } from "next/server";

import { isValidShareToken } from "@/lib/share-token";
import { getShareStore } from "@/lib/share-store";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  if (!isValidShareToken(token)) return NextResponse.json({ error: "Geçersiz paylaşım bağlantısı." }, { status: 400 });
  try {
    await getShareStore().revoke(token);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[share] Snapshot kaldırılamadı:", error);
    return NextResponse.json({ error: "Paylaşım bağlantısı kaldırılamadı." }, { status: 500 });
  }
}
