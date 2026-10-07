import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { notificationTargetUrl } from "./reminder-dispatch";

/**
 * `public/sw.js` gerçek push/service worker yükünü test eder.
 *
 * Worker, sahte `self` nesnesiyle eval edilir; `push` ve
 * `notificationclick` olayları gerçek olay nesnesi biçiminde tetiklenir.
 * Böylece payload çözümü, tag tabanlı tekilleştirme ve bildirim tıklama
 * derin bağlantısı doğrudan production dosyası üzerinden doğrulanır.
 */

interface RecordedNotification {
  title: string;
  options: Record<string, unknown>;
}

interface FakeSelf {
  listeners: Record<string, Array<(event: unknown) => void>>;
  addEventListener: (type: string, handler: (event: unknown) => void) => void;
  registration: {
    showNotification: (title: string, options: Record<string, unknown>) => Promise<void>;
    notifications: RecordedNotification[];
  };
  clients: {
    matchAll: () => Promise<Array<{ url: string; focus: () => Promise<void>; navigate: (url: string) => void }>>;
    openWindow: (url: string) => Promise<void>;
    opened: string[];
    focused: string[];
    navigated: string[];
    windows: Array<{ url: string; focus: () => Promise<void>; navigate: (url: string) => void }>;
  };
  location: { origin: string };
  skipWaiting: () => void;
}

function loadServiceWorker(origin = "https://app.test"): FakeSelf {
  const source = readFileSync(path.resolve(__dirname, "../../public/sw.js"), "utf8");

  const self: FakeSelf = {
    listeners: {},
    addEventListener(type: string, handler: (event: unknown) => void) {
      (this.listeners[type] ??= []).push(handler);
    },
    registration: {
      notifications: [],
      showNotification(title, options) {
        this.notifications.push({ title, options });
        return Promise.resolve();
      },
    },
    clients: {
      opened: [],
      focused: [],
      navigated: [],
      windows: [],
      matchAll() {
        return Promise.resolve(this.windows);
      },
      openWindow(url) {
        this.opened.push(url);
        return Promise.resolve();
      },
    },
    location: { origin },
    skipWaiting: () => undefined,
  };

  // Worker kaynağındaki `self` bağımlılığı sahte nesneyle karşılanır.
  new Function("self", `${source}\n`)(self);
  return self;
}

function dispatch(self: FakeSelf, type: string, event: unknown): void {
  for (const handler of self.listeners[type] ?? []) handler(event);
}

/** `waitUntil` sözleşmesini karşılayan push olayı. */
function pushEvent(data: unknown) {
  const promises: Promise<unknown>[] = [];
  return {
    event: {
      data: data === null
        ? null
        : {
            json: () => {
              if (typeof data === "string") return JSON.parse(data);
              return data;
            },
            text: () => (typeof data === "string" ? data : JSON.stringify(data)),
          },
      waitUntil: (promise: Promise<unknown>) => {
        promises.push(promise);
      },
    },
    settled: async () => {
      await Promise.all(promises);
    },
  };
}

describe("public/sw.js — push yükü", () => {
  it("JSON payload ile bildirimi tag ile gösterir", async () => {
    const self = loadServiceWorker();
    const payload = {
      title: "Hatırlatma",
      body: "Reel yayın saati",
      itemId: "item-1",
      brandId: "brand-1",
      date: "2026-10-07",
    };
    const { event, settled } = pushEvent(payload);
    dispatch(self, "push", event);
    await settled();

    expect(self.registration.notifications).toHaveLength(1);
    const [notification] = self.registration.notifications;
    expect(notification.title).toBe("Hatırlatma");
    expect(notification.options.body).toBe("Reel yayın saati");
    expect(notification.options.tag).toBe("dijivo-item-1");
    expect(notification.options.renotify).toBe(true);
  });

  it("aynı hatırlatma için sabit tag üretir (tek bildirim)", async () => {
    const self = loadServiceWorker();
    for (let i = 0; i < 3; i += 1) {
      const { event, settled } = pushEvent({ title: "T", body: "B", itemId: "same-item" });
      dispatch(self, "push", event);
      await settled();
    }
    // Üç çağrı da AYNI tag ile yapılır; tarayıcı tek bildirim gösterir.
    const tags = self.registration.notifications.map((n) => n.options.tag);
    expect(new Set(tags).size).toBe(1);
    expect(tags[0]).toBe("dijivo-same-item");
  });

  it("geçersiz JSON için text yüküne düşer", async () => {
    const self = loadServiceWorker();
    const { event, settled } = pushEvent("ham metin yükü");
    // JSON.parse fırlatır; readPushPayload text yolunu kullanmalı.
    dispatch(self, "push", event);
    await settled();
    expect(self.registration.notifications).toHaveLength(1);
    expect(self.registration.notifications[0].title).toBe("ham metin yükü");
    expect(self.registration.notifications[0].options.tag).toBe("dijivo-reminder");
  });

  it("boş payload ile yine bildirim gösterir (çökmez)", async () => {
    const self = loadServiceWorker();
    const { event, settled } = pushEvent(null);
    dispatch(self, "push", event);
    await settled();
    expect(self.registration.notifications).toHaveLength(1);
    expect(self.registration.notifications[0].options.tag).toMatch(/^dijivo-reminder/);
  });
});

describe("public/sw.js — notificationclick derin bağlantısı", () => {
  it("açık pencere varsa onu takvim bağlamına yönlendirir", async () => {
    const self = loadServiceWorker("http://localhost:3000");
    const targetUrl = "/?view=calendar&brand=brand-1&date=2026-10-07&item=item-9";
    expect(notificationTargetUrl({ brandId: "brand-1", date: "2026-10-07", itemId: "item-9" })).toBe(targetUrl);
    const client = {
      url: "http://localhost:3000/",
      focus: () => {
        self.clients.focused.push("existing");
        return Promise.resolve();
      },
      navigate: (url: string) => {
        self.clients.navigated.push(url);
      },
    };
    self.clients.windows = [client];

    let closed = false;
    const promises: Promise<unknown>[] = [];
    dispatch(self, "notificationclick", {
      notification: {
        data: { brandId: "brand-1", date: "2026-10-07", itemId: "item-9" },
        close: () => {
          closed = true;
        },
      },
      waitUntil: (p: Promise<unknown>) => {
        promises.push(p);
      },
    });
    await Promise.all(promises);

    expect(closed).toBe(true);
    expect(self.clients.navigated).toEqual([targetUrl]);
    expect(self.clients.focused).toEqual(["existing"]);
    expect(self.clients.opened).toEqual([]);
  });

  it("açık pencere yoksa yeni pencere açar", async () => {
    const self = loadServiceWorker("http://localhost:3000");
    const targetUrl = "/?view=calendar&brand=brand-1&date=2026-10-07&item=item-9";
    self.clients.windows = [];

    const promises: Promise<unknown>[] = [];
    dispatch(self, "notificationclick", {
      notification: {
        data: { brandId: "brand-1", date: "2026-10-07", itemId: "item-9" },
        close: () => undefined,
      },
      waitUntil: (p: Promise<unknown>) => {
        promises.push(p);
      },
    });
    await Promise.all(promises);

    expect(self.clients.opened).toEqual([targetUrl]);
  });

  it("worker derin bağlantısı reminder-dispatch ile birebir aynı", async () => {
    const payload = { brandId: "brand-1", date: "2026-10-07", itemId: "item-9" };
    const self = loadServiceWorker("http://localhost:3000");
    expect(self.location.origin).toBe("http://localhost:3000");

    self.clients.windows = [];
    const promises: Promise<unknown>[] = [];
    dispatch(self, "notificationclick", {
      notification: { data: payload, close: () => undefined },
      waitUntil: (p: Promise<unknown>) => {
        promises.push(p);
      },
    });
    await Promise.all(promises);

    // buildTargetUrl (sw.js) ile notificationTargetUrl (reminder-dispatch)
    // aynı sorgu düzenini üretmeli — ikisi de asla ayrılmasın.
    expect(self.clients.opened).toEqual([notificationTargetUrl(payload)]);
    expect(self.clients.opened[0]).toBe(
      "/?view=calendar&brand=brand-1&date=2026-10-07&item=item-9",
    );
  });
});
