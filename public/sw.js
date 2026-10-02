/*
 * Dijivo Grid — push service worker'ı (§29).
 *
 * Bu fazda yalnızca install/activate döngüsünü yönetir;
 * gelecekte bir push sunucusu (VAPID + web push) eklendiğinde
 * push event'i burada ele alınacaktır. Uygulama açıkken gönderilen
 * yerel bildirimler service worker'a gerekmez (main thread).
 */

self.addEventListener("install", (event) => {
  // Derhal aktif olsun; eski worker'lar temizlensin.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

/* Gelecek push entegrasyonu:
self.addEventListener("push", (event) => { ... });
self.addEventListener("notificationclick", (event) => { ... });
*/
