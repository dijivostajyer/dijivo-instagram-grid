import { NextResponse } from "next/server";

import { NO_STORE, createBackupEngine, engineUnavailable, verifyCronRequest } from "@/lib/backup/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KEEPALIVE_MS = 15_000;

/**
 * cPanel Cron Job tetikleyicisi (ör. 15 dakikada bir). Kullanıcı oturumuna
 * bağlı değildir; yalnız `Authorization: Bearer <BACKUP_CRON_SECRET>` kabul
 * edilir. Zamanı gelmemişse iş yapmaz (not_due). Yedek sürerken yanıt
 * boşluk karakterleriyle canlı tutulur: proxy zaman aşımı isteği kesmez ve
 * Passenger işi bitene kadar süreci boşta saymaz. Gövde sonunda JSON sonuçtur.
 */
export async function POST(request: Request) {
  const auth = verifyCronRequest(request);
  if (auth === "unconfigured") return NextResponse.json({ error: "Zamanlanmış yedekleme yapılandırılmamış." }, { status: 503, headers: NO_STORE });
  if (auth === "denied") return NextResponse.json({ error: "Yetkisiz." }, { status: 401, headers: NO_STORE });
  const engine = createBackupEngine();
  if (!engine) return engineUnavailable();

  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const timer = setInterval(() => controller.enqueue(encoder.encode(" ")), KEEPALIVE_MS);
      let result: unknown;
      try {
        result = await engine.runScheduled();
      } catch (error) {
        console.error("[backup]", { event: "scheduled_route_error", error: error instanceof Error ? error.message : "bilinmeyen hata" });
        result = { status: "failed", error: "Zamanlanmış yedekleme çalıştırılamadı." };
      } finally {
        clearInterval(timer);
      }
      controller.enqueue(encoder.encode(`${JSON.stringify(result)}\n`));
      controller.close();
    },
  });
  return new Response(body, { headers: { ...NO_STORE, "Content-Type": "application/json; charset=utf-8", "X-Accel-Buffering": "no" } });
}
