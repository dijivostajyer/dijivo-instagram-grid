import type { SupabaseClient } from "@supabase/supabase-js";

import type { StorageLike } from "../storage";

/**
 * Geri yükleme sonrası istemci tutarlılığı.
 *
 * Sunucu her başarılı geri yüklemede `workspace_sync_state.restore_epoch`
 * değerini yeniler. İstemci yerel kopyasının hangi epoch'a ait olduğunu
 * localStorage'da tutar:
 *   - Açılışta epoch farklıysa yerel kopya (localStorage + IndexedDB) bayattır;
 *     buluta geri yazılmadan atılır ve uygulama buluttan yeniden yüklenir.
 *   - Açık bir sekme/cihaz epoch değişimini fark ederse otomatik kaydı durdurur
 *     (bayat veri geri yüklenen verinin üzerine yazılmaz).
 */
export const RESTORE_EPOCH_KEY = "dijivo-grid-restore-epoch";
export const RESTORE_NOTICE_KEY = "dijivo-grid-restore-notice";
export const RESTORED_ELSEWHERE_MESSAGE = "Çalışma alanı bir yedekten geri yüklendi. Güncel verileri görmek için sayfayı yenileyin; bu sekmedeki değişiklikler kaydedilmedi.";

export function readLocalEpoch(storage: StorageLike | null): string | null {
  try {
    return storage?.getItem(RESTORE_EPOCH_KEY) ?? null;
  } catch {
    return null;
  }
}

export function writeLocalEpoch(storage: StorageLike | null, epoch: string | null): void {
  try {
    if (epoch) storage?.setItem(RESTORE_EPOCH_KEY, epoch);
    else storage?.removeItem(RESTORE_EPOCH_KEY);
  } catch {
    // depolama kapalıysa epoch yalnız bellekte izlenir
  }
}

/**
 * Sunucudaki epoch. `supported: false`: tablo henüz yok (migration
 * uygulanmamış) veya okunamadı; bu durumda eski davranış sürer.
 */
export async function readRemoteRestoreEpoch(db: Pick<SupabaseClient, "from">): Promise<{ supported: boolean; epoch: string | null }> {
  try {
    const { data, error } = await db.from("workspace_sync_state").select("restore_epoch").eq("id", true).maybeSingle();
    if (error) return { supported: false, epoch: null };
    const epoch = (data as { restore_epoch?: unknown } | null)?.restore_epoch;
    return { supported: true, epoch: typeof epoch === "string" ? epoch : null };
  } catch {
    return { supported: false, epoch: null };
  }
}

export function markRestoreNotice(): void {
  try {
    window.sessionStorage.setItem(RESTORE_NOTICE_KEY, "1");
  } catch {
    // bildirim yalnız gösterilmez
  }
}

/** Yeniden yükleme sonrası tek seferlik "Geri yükleme tamamlandı." bildirimi. */
export function consumeRestoreNotice(): boolean {
  try {
    if (window.sessionStorage.getItem(RESTORE_NOTICE_KEY) !== "1") return false;
    window.sessionStorage.removeItem(RESTORE_NOTICE_KEY);
    return true;
  } catch {
    return false;
  }
}
