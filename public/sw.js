/*
 * Dijivo Grid — push service worker'ı.
 *
 * Gerçek web push teslimatını karşılar:
 *   - `push`            → VAPID ile gelen şifreli yükü çözer, `showNotification`
 *   - `notificationclick` → uygulamayı açar ve ilgili takvim kaydına gider
 *   - `install/activate` → eski worker'ları temizler, istemcileri devralır
 *
 * Gönderen taraf: supabase/functions/reminder-dispatch
 * (bkz. src/lib/reminder-dispatch.ts ve SUPABASE-KURULUM.md).
 *
 * Gizli anahtar (VAPID private key) BURAYA ASLA yazılmaz; worker
 * yalnızca public key ile push abonelir.
 */

const DEFAULT_TITLE = "Dijivo";
// Mevcut app ikonu (src/app/icon.svg); var olmayan bir dosya 404 üretmesin.
const DEFAULT_ICON = "/icon.svg";
const DEFAULT_BADGE = "/icon.svg";

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

/**
 * Bildirim verisinden uygulama içi hedef üretir.
 * `src/lib/reminder-dispatch.ts` içindeki `notificationTargetUrl` ile
 * aynı kuralı uygular (marka + tarih + kayıt bağlamı).
 */
function buildTargetUrl(data) {
  const params = new URLSearchParams();
  params.set("view", "calendar");
  if (data && typeof data.brandId === "string") params.set("brand", data.brandId);
  if (data && typeof data.date === "string") params.set("date", data.date);
  if (data && typeof data.itemId === "string") params.set("item", data.itemId);
  return `/?${params.toString()}`;
}

function readPushPayload(event) {
  if (!event.data) return {};
  try {
    return event.data.json();
  } catch {
    return { title: event.data.text ? event.data.text() : "" };
  }
}

self.addEventListener("push", (event) => {
  const payload = readPushPayload(event);
  const title =
    typeof payload.title === "string" && payload.title
      ? payload.title
      : DEFAULT_TITLE;
  const body = typeof payload.body === "string" ? payload.body : "";
  // Aynı hatırlatma için tek bildirim: tag ile yenisi eskisini değiştirir.
  const tag =
    typeof payload.tag === "string" && payload.tag
      ? payload.tag
      : `dijivo-${typeof payload.itemId === "string" ? payload.itemId : "reminder"}`;

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag,
      renotify: true,
      icon: DEFAULT_ICON,
      badge: DEFAULT_BADGE,
      data: payload,
      // Kalıcı kalması gerektiği kadar; kullanıcı kapatabilir.
      requireInteraction: false,
      vibrate: [80, 40, 80],
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = buildTargetUrl(event.notification.data);
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(
      (clientList) => {
        for (const client of clientList) {
          if (new URL(client.url).origin === self.location.origin) {
            if ("focus" in client) {
              client.navigate(target);
              return client.focus();
            }
          }
        }
        return self.clients.openWindow(target);
      },
    ),
  );
});

/** Kullanıcı tüm bildirimleri kapatırsa. */
self.addEventListener("notificationclose", () => {
  // Şimdilik yalnızca yaşam döngüsü; sunucu tarafı sayaç tutmuyor.
});