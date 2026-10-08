/**
 * Takvim arka uç seçimi (§ production source of truth).
 *
 * İki kural:
 *
 * 1. **Source of truth.** Supabase yapılandırılmış VE erişilebilir
 *    ise production kaynağı odur; localStorage yalnızca
 *    cache/fallback'tir. Erişilemiyorsa (migration uygulanmamış,
 *    proje askıda, ağ yok) `LocalCalendarStore` kullanılır ve
 *    kullanıcı verisi kaybolmaz.
 */

/** Arka uç seçimi. */
export type CalendarBackend = "supabase" | "local";

export interface BackendProbe {
  /** `SUPABASE_URL` ve `SUPABASE_SECRET_KEY` tanımlı mı? */
  configured: boolean;
  /** `calendar_items` tablosu gerçekten okunabildi mi? */
  reachable: boolean;
}

/**
 * Yapılandırılmış **ve** erişilebilir ise Supabase üretim kaynağıdır.
 * Aksi halde local fallback (veri kaybı olmaz).
 */
export function selectCalendarBackend(probe: BackendProbe): CalendarBackend {
  return probe.configured && probe.reachable ? "supabase" : "local";
}

/** Production'da veri tutulması gereken arka uç. */
export function isSourceOfTruth(backend: CalendarBackend): boolean {
  return backend === "supabase";
}
