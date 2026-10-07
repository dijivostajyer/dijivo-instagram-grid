/**
 * Tarayıcı bildirimi ve web push altyapısı (§29 / § background notifications).
 *
 * Bu fazda gerçek çalışan:
 * - `Notification.requestPermission()` ile izin (HTTPS/localhost).
 * - Uygulama açıkken `new Notification(...)` ile yerel bildirim.
 * - `public/sw.js` service worker kaydı — `push` ve `notificationclick`
 *   dinleyicileri gerçek; abonelik backend'e kaydedilir.
 * - `PushManager.subscribe()` + `POST /api/push/subscriptions`.
 *
 * Arka plan teslimatının kaynağı backend'dir:
 * `supabase/functions/reminder-dispatch` (pg_cron ile her dakika).
 * Uygulama kapalıyken gönderim bu işçi tarafından yapılır.
 *
 * VAPID **private** anahtarı yalnızca Edge Function secret'ıdır; bu
 * dosyaya veya client bundle'a girmez. İstemci yalnızca VAPID *public*
 * key ile abone olur ve sunucu anahtarlarını göremez.
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
 * Tarayıcı bildirimi izni ister. İzin verildiyse service worker
 * kaydedilir ve backend'e push aboneliği gönderilir.
 *
 * Abonelik kaydedilemezse izin yine de "granted" kalır (in-app
 * bildirimler çalışmaya devam eder); çağıran taraf
 * `subscribePush` sonucunu yutmalıdır.
 */
export async function requestNotificationPermission(
  brandId?: string,
): Promise<NotificationPermission | "unsupported"> {
  if (!isNotificationSupported()) return "unsupported";
  const permission = await window.Notification.requestPermission();
  if (permission === "granted") {
    await registerPushServiceWorker();
    if (brandId) await subscribePush(brandId);
  }
  return permission;
}

/**
 * VAPID public key. `NEXT_PUBLIC_VAPID_PUBLIC_KEY` bilinçli olarak
 * public'tir — public anahtar gizli değildir ve abonelik için
 * kullanılır. **Private** anahtar asla istemciye girmez.
 */
export function vapidPublicKey(): string | null {
  const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  return key && key.length > 0 ? key : null;
}

/**
 * Service worker'a push aboneliği açar ve backend'e kaydeder.
 * Public anahtar yoksa veya abonelik reddedilirse `false` döner;
 * in-app bildirimler etkilenmez.
 */
export async function subscribePush(brandId: string): Promise<boolean> {
  if (!isNotificationSupported()) return false;
  const key = vapidPublicKey();
  if (!key) return false;
  try {
    const registration = await registerPushServiceWorker();
    if (!registration) return false;
    const existing = await registration.pushManager.getSubscription();
    const subscription =
      existing ??
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key) as BufferSource,
      }));
    const response = await fetch("/api/push/subscriptions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ brandId, subscription: subscription.toJSON() }),
    });
    return response.ok;
  } catch (error) {
    console.warn("[calendar] Push aboneliği kurulamadı:", error);
    return false;
  }
}

/** VAPID base64url public key → Uint8Array (applicationServerKey). */
export function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(normalized);
  const output = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) {
    output[index] = raw.charCodeAt(index);
  }
  return output;
}

/**
 * Service worker kaydını döndürür (push aboneliği için gerekli);
 * kayıt başarısızsa `null`.
 */
export async function registerPushServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  try {
    const registration = await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;
    return registration;
  } catch (error) {
    // localhost/HTTPS dışı ortamlarda kayıt reddedilebilir;
    // in-app hatırlatmalar buna bağlı değildir.
    console.warn("[calendar] Service worker kaydedilemedi:", error);
    return null;
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
