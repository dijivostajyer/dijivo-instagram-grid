import { afterEach, describe, expect, it, vi } from "vitest";

import {
  requestNotificationPermission,
  subscribePush,
  urlBase64ToUint8Array,
} from "./browser-push";

const vapidKey =
  "BGG6SiLBB4Ftvzks4rGNW9V1b77wx8dAOdEoZY4Pb29mxr9o9PZKu8OtN5GNkjy97j9d7Yy-EKb8SGdI1HroiIQ";

function installBrowserMocks(permission: NotificationPermission = "granted") {
  const subscription = {
    toJSON: () => ({
      endpoint: "https://fcm.googleapis.com/fcm/send/test-subscription",
      keys: { p256dh: "p256dh-key", auth: "auth-key" },
    }),
  };
  const subscribe = vi.fn(async () => subscription);
  const getSubscription = vi.fn(async () => null);
  const registration = { pushManager: { getSubscription, subscribe } };
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { Notification: { permission, requestPermission: vi.fn() } },
  });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      serviceWorker: {
        register: vi.fn(async () => registration),
        ready: Promise.resolve(registration),
      },
    },
  });
  return { getSubscription, subscribe, registration };
}

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(globalThis, "window");
  Reflect.deleteProperty(globalThis, "navigator");
  vi.unstubAllEnvs();
});

describe("browser push", () => {
  it("VAPID base64url anahtarını 65 baytlık applicationServerKey'e çevirir", () => {
    expect(urlBase64ToUint8Array(vapidKey)).toHaveLength(65);
  });

  it("izin zaten verilmişse UI akışı tekrar izin istemeden aboneliği kaydeder", async () => {
    vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", vapidKey);
    const mocks = installBrowserMocks();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(requestNotificationPermission("brand-1")).resolves.toBe("granted");
    expect(window.Notification.requestPermission).not.toHaveBeenCalled();
    expect(mocks.getSubscription).toHaveBeenCalledOnce();
    expect(mocks.subscribe).toHaveBeenCalledWith({
      userVisibleOnly: true,
      applicationServerKey: expect.any(Uint8Array),
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/push/subscriptions",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("kayıt API'sinin hata gövdesini console'da teşhis edilebilir bırakır", async () => {
    vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", vapidKey);
    installBrowserMocks();
    vi.stubGlobal("fetch", vi.fn(async () => new Response('{"error":"database"}', { status: 502 })));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(subscribePush("brand-1")).resolves.toBe(false);
    expect(warn).toHaveBeenCalledWith(
      "[calendar] Push aboneliği kaydedilemedi:",
      { status: 502, body: '{"error":"database"}' },
    );
  });
});
