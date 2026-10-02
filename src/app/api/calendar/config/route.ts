import { NextResponse } from "next/server";

import {
  createSupabaseCalendarDriver,
  getSupabaseCalendarConfig,
} from "@/lib/supabase-calendar-store";

/**
 * Sağlık probe zaman aşımı (ms). Ücretsiz Supabase
 * projeleri askıya alınmış olabilir; beklemesiz
 * yerel depoya düşüyoruz.
 */
const PROBE_TIMEOUT_MS = 4_000;

/**
 * İstemci store seçimi (§22): Supabase yapılandırılmış
 * VE erişilebilir mi? Yalnızca boolean döner — secret
 * key asla dışarı çıkmaz.
 *
 * Sağlık probe: `calendar_items` üstünden 1 satır okur.
 * Bağlantı kopuk, proje askıda veya migration uygulanmamış
 * ise `supabase: false` döner; istemci yerel depoya düşer
 * (graceful degradation — veri kaybı olmaz, kullanıcı
 * Supabase geri gelince tekrar API katmanına geçer).
 */
export async function GET(): Promise<NextResponse> {
  const config = getSupabaseCalendarConfig();
  if (!config) {
    return NextResponse.json({ supabase: false });
  }
  try {
    const driver = createSupabaseCalendarDriver(config);
    const reachable = await Promise.race([
      driver.listItems("", "").then(
        () => true,
        () => false,
      ),
      new Promise<boolean>((resolve) => {
        setTimeout(() => resolve(false), PROBE_TIMEOUT_MS);
      }),
    ]);
    return NextResponse.json({ supabase: reachable });
  } catch {
    return NextResponse.json({ supabase: false });
  }
}
