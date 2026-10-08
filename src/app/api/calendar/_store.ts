import {
  createSupabaseCalendarDriver,
  getSupabaseCalendarConfig,
  SupabaseCalendarStore,
} from "@/lib/supabase-calendar-store";

/**
 * Supabase yapılandırılmışsa service-role üzerinden
 * takvim deposu döner; yoksa `null` (istemci yerel
 * depolamaya düşer). Secret key istemci bundle'ına
 * asla girmez (§28).
 */
export function getCalendarStore(): SupabaseCalendarStore | null {
  const config = getSupabaseCalendarConfig();
  if (!config) return null;
  return new SupabaseCalendarStore(createSupabaseCalendarDriver(config));
}
