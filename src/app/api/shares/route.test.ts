import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Paylaşım oluşturma rotası GERÇEK handler olarak çalıştırılır; tüm console çıktıları yakalanır ve
 * üretilen paylaşım token'ının, kullanıcının bearer token'ının ve Authorization başlığının hiçbir log
 * argümanında (çok satırlı çağrılar dahil) bulunmadığı doğrulanır. Kaynak-kod regex'ine dayanmaz.
 */
const SHARE_TOKEN = "3e1a1c76-7958-4d4f-86c6-2727195fd44c";
const USER_BEARER = "bearer-gizli-kullanici-tokeni-123";

const world = vi.hoisted(() => ({
  createError: null as Error | null,
}));

vi.mock("@/lib/share-store", () => ({
  getShareStore: () => ({
    create: async () => {
      if (world.createError) throw world.createError;
      return { token: "3e1a1c76-7958-4d4f-86c6-2727195fd44c", version: 1, createdAt: "2026-11-26T00:00:00.000Z" };
    },
  }),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: {
      getUser: async (token: string) =>
        token === "bearer-gizli-kullanici-tokeni-123"
          ? { data: { user: { id: "11111111-1111-4111-8111-111111111111" } }, error: null }
          : { data: { user: null }, error: { message: "invalid JWT" } },
    },
    from: () => {
      const builder = {
        select: () => builder,
        eq: () => builder,
        maybeSingle: async () => ({ data: { id: "b1" }, error: null }),
      };
      return builder;
    },
  }),
}));

import { POST } from "./route";

const cell = (imageUrl: string) => ({ id: "c1", source: "mevcut", imageUrl, position: 0, row: 0, column: 0, pinned: false });
const payload = (imageUrl = "storage:workspace-media/11111111-1111-4111-8111-111111111111/b1/post/a.jpg") => ({
  brand: { name: "Dijivo", username: "dijivo" },
  cells: [cell(imageUrl)],
  context: { brandId: "b1", projectId: "p1" },
});

function call(body: unknown, authorization: string | null = `Bearer ${USER_BEARER}`) {
  return POST(new Request("https://app.test/api/shares", {
    method: "POST",
    headers: { "content-type": "application/json", ...(authorization ? { authorization } : {}) },
    body: typeof body === "string" ? body : JSON.stringify(body),
  }));
}

const channels = ["log", "info", "warn", "error", "debug"] as const;
let spies: Array<ReturnType<typeof vi.spyOn>>;
/** Tüm kanallardaki tüm argümanların serileştirilmiş hali (çok satırlı/iç içe nesneler dahil). */
const allLogged = () => spies.flatMap((spy) => spy.mock.calls.map((args) => args.map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg, (_key, value) => (value instanceof Error ? { name: value.name, message: value.message, stack: value.stack } : value))))).map((parts) => parts.join(" "))).join("\n");

beforeEach(() => {
  process.env.SUPABASE_URL = "https://proj.supabase.co";
  process.env.SUPABASE_SECRET_KEY = "test-service-key";
  world.createError = null;
  spies = channels.map((channel) => vi.spyOn(console, channel).mockImplementation(() => undefined));
});

// Spy'lar her testten sonra geri yüklenir: her test yalnız KENDİ log çağrılarını yakalar
// (aksi halde çağrılar testler arası birikir ve "log üretildi" kontrolleri önceki testin logları sayesinde geçebilirdi).
afterEach(() => {
  vi.restoreAllMocks();
});

describe("paylaşım oluşturma: gerçek log çıktısında token/yetki bilgisi yok", () => {
  it("başarılı oluşturma: yanıt token'ı döner ama hiçbir log token, bearer veya Authorization içermez; requestId korunur", async () => {
    const response = await call(payload());
    expect(response.status).toBe(201);
    const body = (await response.json()) as { token: string; requestId: string };
    expect(body.token).toBe(SHARE_TOKEN); // istemci bağlantıyı bununla kurar
    const logged = allLogged();
    expect(logged.length).toBeGreaterThan(0); // log gerçekten üretildi (boş çıktıyla geçmiyor)
    expect(logged).not.toContain(SHARE_TOKEN);
    expect(logged).not.toContain(USER_BEARER);
    expect(logged).not.toContain("test-service-key");
    expect(logged.toLowerCase()).not.toContain("authorization");
    expect(logged).toContain(body.requestId); // operasyonel izleme korunuyor
    expect(logged).toContain("Snapshot oluşturuldu");
  });

  it("yetkisiz istek (geçersiz bearer): log bearer değerini veya başlığı içermez", async () => {
    const response = await call(payload(), "Bearer sahte-baska-token-456");
    expect(response.status).toBe(401);
    const logged = allLogged();
    expect(logged).not.toContain("sahte-baska-token-456");
    expect(logged.toLowerCase()).not.toContain("bearer sahte");
    expect(logged).not.toContain(SHARE_TOKEN);
  });

  it("geçersiz payload / başka kullanıcının medya referansı / depo hatası: loglar token, bearer, payload gövdesi veya imzalı URL içermez", async () => {
    await call("{bozuk json");
    await call(payload("storage:workspace-media/22222222-2222-4222-8222-222222222222/b9/post/hirsiz.jpg"));
    world.createError = new Error("snapshot kaydedilemedi");
    const failed = await call(payload());
    expect(failed.status).toBe(500);
    const logged = allLogged();
    expect(logged.length).toBeGreaterThan(0);
    expect(logged).not.toContain(SHARE_TOKEN);
    expect(logged).not.toContain(USER_BEARER);
    expect(logged).not.toContain("hirsiz.jpg"); // medya yolu/payload loglanmaz
    expect(logged).not.toMatch(/https?:\/\/\S*(token|signature)=/i); // imzalı URL yok
  });
});

describe("log yakalama testler arasında yalıtılmıştır", () => {
  it("her testin başında yakalanan log boştur; ardından yalnızca bu testin çağrısının logları görünür", async () => {
    expect(allLogged()).toBe(""); // önceki testlerin logları taşınmaz
    const response = await call(payload());
    expect(response.status).toBe(201);
    const logged = allLogged();
    expect(logged.length).toBeGreaterThan(0); // bu testin kendi çağrısı log üretti
    expect(logged.match(/Snapshot oluşturuldu/g)).toHaveLength(1); // başka testlerin kayıtları yok
  });

  it("art arda ikinci test de sıfırdan başlar (birikim yok)", async () => {
    expect(allLogged()).toBe("");
    await call(payload(), "Bearer sahte-baska-token-456");
    expect(allLogged()).not.toContain("Snapshot oluşturuldu"); // önceki testin başarılı akış logu karışmaz
  });
});
