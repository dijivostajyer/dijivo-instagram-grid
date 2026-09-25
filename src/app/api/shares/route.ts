import { NextResponse } from "next/server";

import { validateShareSnapshotInput } from "@/lib/share";
import { shareStore } from "@/lib/share-store";

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const input = validateShareSnapshotInput(await request.json());
    if (!input) {
      return NextResponse.json(
        { error: "Paylaşılabilir grid bulunamadı." },
        { status: 400 },
      );
    }
    const snapshot = await shareStore.create(input);
    return NextResponse.json({ token: snapshot.token }, { status: 201 });
  } catch (error) {
    console.error("[share] Snapshot oluşturulamadı:", error);
    return NextResponse.json(
      { error: "Paylaşım bağlantısı oluşturulamadı. Lütfen tekrar deneyin." },
      { status: 500 },
    );
  }
}
