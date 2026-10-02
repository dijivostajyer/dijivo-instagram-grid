/**
 * Tarayıcı bildirimi altyapısı (§29).
 *
 * Bu fazda şunlar gerçek çalışır:
 * - `Notification.requestPermission()` ile izin (HTTPS/localhost).
 * - Uygulama açıkken `new Notification(...)` ile yerel bildirim.
 * - Gelecekteki push için minimal bir service worker kaydı.
 *
 * Dürüst sınır: uygulama KAPALIYKEN bildirim (gerçek push),
 * bir push sunucusu + VAPID anahtarları + web push kütüphanesi
 * gerektirir; bu altyapı bu fazda dahil değildir (ai-handoff.md
 * "Known limitations" bölümünde belgelenir).
 */

export function isNotificationSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "Notification" in window &&
    "serviceWorker" in navigator
  );
}

/** İzin durumu: granted / denied / default / unsupported. */
export function notificationPermission(): NotificationPermission | "unsupported" {
  if (!isNotificationSupported()) return "unsupported";
  return window.Notification.permission;
}

/**
 * Tarayıcı bildirimi izni ister. İzin verildiyse gelecekteki
 * push için service worker'ı kaydeder.
 */
export async function requestNotificationPermission(): Promise<NotificationPermission | "unsupported"> {
  if (!isNotificationSupported()) return "unsupported";
  const permission = await window.Notification.requestPermission();
  if (permission === "granted") {
    await registerPushServiceWorker();
  }
  return permission;
}

/**
 * Minimal service worker kaydı. `public/sw.js` yalnızca
 * install/active döngüsünü yönetir; push event'i gelecekte
 * (push sunucusu eklendiğinde) bu worker'a eklenir.
 */
export async function registerPushServiceWorker(): Promise<boolean> {
  if (!("serviceWorker" in navigator)) return false;
  try {
    await navigator.serviceWorker.register("/sw.js");
    return true;
  } catch (error) {
    // localhost/HTTPS dışı ortamlarda kayıt reddedilebilir;
    // in-app hatırlatmalar buna bağlı değildir.
    console.warn("[calendar] Service worker kaydedilemedi:", error);
    return false;
  }
}

/**
 * Yerel tarayıcı bildirimi gösterir (uygulama açıkken).
 * İzin yoksa sessizce atlanır — in-app bildirim her zaman gelir.
 */
export function showBrowserNotification(
  title: string,
  body: string,
): boolean {
  if (!isNotificationSupported() || window.Notification.permission !== "granted") {
    return false;
  }
  try {
    // eslint-disable-next-line no-new
    new window.Notification(title, { body });
    return true;
  } catch {
    return false;
  }
}
