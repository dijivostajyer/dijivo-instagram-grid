import { beforeEach, describe, expect, it, vi } from "vitest";

const STAGING_REF = "yprmrkvikhijxznwvjni";
const STAGING_URL = `https://${STAGING_REF}.supabase.co`;

/**
 * Sahte istemci: ag yok. `state.calls` hedefe ulasan her cagriyi kaydeder.
 * Kilit satiri birincil anahtar gibi davranir (ikinci ekleme 23505 ile reddedilir); `state.fail`
 * belirli adimlari basarisiz kilar.
 */
const state = vi.hoisted(() => ({
  calls: [] as string[],
  users: 0,
  lock: false,
  owner: null as string | null,
  fail: new Set<string>(),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => {
    state.calls.push("createClient");
    return {
      auth: {
        admin: {
          listUsers: async () => {
            state.calls.push("listUsers");
            return { data: { users: Array.from({ length: state.users }, (_, i) => ({ id: `u${i}` })) }, error: null };
          },
          createUser: async () => {
            state.calls.push("createUser");
            // Test kancası: kilit/sahip başka bir işlemce değiştirilmiş gibi davran (createUser sonucundan bağımsız).
            if (state.fail.has("externalOwner")) state.owner = "legit-owner";
            if (state.fail.has("lockVanishes")) state.lock = false;
            if (state.fail.has("createUserThrow")) throw new Error("sahte-istisna-ayrintisi postgres://gizli-host");
            if (state.fail.has("createUserNoUser")) return { data: { user: null }, error: null };
            if (state.fail.has("createUser")) return { data: { user: null }, error: { message: "Database error creating new user: sahte-saglayici-ayrintisi (hesap@ornek.com)", code: "unexpected_failure", status: 500 } };
            state.users += 1;
            return { data: { user: { id: "new-user" } }, error: null };
          },
          deleteUser: async (id: string) => {
            state.calls.push(`deleteUser:${id}`);
            if (state.fail.has("deleteUserThrow")) throw new Error("sahte silme istisnası");
            if (state.fail.has("deleteUser")) return { data: null, error: { code: "unexpected_failure", message: "sahte silme hatası" } };
            state.users -= 1;
            return { data: {}, error: null };
          },
        },
      },
      from: (table: string) => ({
        insert: async () => {
          state.calls.push(`insert:${table}`);
          if (state.lock) return { error: { code: "23505", message: "duplicate key" } };
          state.lock = true;
          return { error: null };
        },
        update: (patch: { owner_id: string }) => ({
          eq: () => ({
            is: () => ({
              select: async () => {
                state.calls.push(`update:${table}`);
                if (state.fail.has("ownerUpdateThrow")) throw new Error("sahte güncelleme istisnası");
                if (state.fail.has("ownerUpdate")) return { data: null, error: { code: "XX000", message: "sahte güncelleme hatası" } };
                if (state.fail.has("ownerZeroRows") || !state.lock || state.owner !== null) return { data: [], error: null };
                state.owner = patch.owner_id;
                return { data: [{ id: true }], error: null };
              },
            }),
          }),
        }),
        // Gerçek sorgu şekli: delete().eq("id", true).is("owner_id", null).select("id") — yalnız SAHİBİ BOŞ kilit silinir.
        delete: () => ({
          eq: () => ({
            is: () => ({
              select: async () => {
                state.calls.push(`delete:${table}`);
                if (state.fail.has("lockDeleteThrow")) throw new Error("sahte kilit silme istisnası");
                if (state.fail.has("lockDelete")) return { data: null, error: { code: "XX000", message: "sahte kilit silme hatası" } };
                if (!state.lock || state.owner !== null) return { data: [], error: null };
                state.lock = false;
                return { data: [{ id: true }], error: null };
              },
            }),
          }),
        }),
      }),
    };
  },
}));

import { GET, POST } from "./route";

function post(body: unknown = { email: "a@example.com", password: "secret1" }) {
  const request = new Request("http://localhost:3000/api/auth/bootstrap", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return POST(request as unknown as Parameters<typeof POST>[0]);
}

function configure(overrides: Record<string, string | undefined> = {}) {
  const env: Record<string, string | undefined> = {
    EXPECTED_SUPABASE_PROJECT_REF: STAGING_REF,
    SUPABASE_URL: STAGING_URL,
    NEXT_PUBLIC_SUPABASE_URL: STAGING_URL,
    SUPABASE_SECRET_KEY: "test-service-key",
    ...overrides,
  };
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

beforeEach(() => {
  state.calls = [];
  state.users = 0;
  state.lock = false;
  state.owner = null;
  state.fail = new Set();
  configure();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("bootstrap hedef proje korumasi", () => {
  it("dogru staging ref'i ve eslesen URL'lerle GET calisir", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ canBootstrap: true });
    expect(state.calls).toContain("listUsers");
  });

  it("dogru staging ref'iyle POST mevcut is mantigini degistirmeden hesap olusturur", async () => {
    const response = await post();
    expect(response.status).toBe(201);
    expect(state.calls).toEqual(["createClient", "listUsers", "insert:workspace_bootstrap", "createUser", "update:workspace_bootstrap"]);
  });

  it("mevcut is mantigi korunur: kullanici varsa POST 409 doner", async () => {
    state.users = 1;
    const response = await post();
    expect(response.status).toBe(409);
    expect(state.calls).not.toContain("createUser");
  });

  it("yanlis ref: SUPABASE_URL baska projeye isaret ederse GET ve POST 503, hedefe hic baglanilmaz", async () => {
    configure({ SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co", NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co" });
    const get = await GET();
    expect(get.status).toBe(503);
    expect(await get.json()).toEqual({ canBootstrap: false });
    expect((await post()).status).toBe(503);
    expect(state.calls).toEqual([]);
  });

  it("beklenen ref yok veya bos: GET ve POST 503 (fail-closed)", async () => {
    for (const value of [undefined, "", "   "]) {
      configure({ EXPECTED_SUPABASE_PROJECT_REF: value });
      expect((await GET()).status).toBe(503);
      expect((await post()).status).toBe(503);
    }
    expect(state.calls).toEqual([]);
  });

  it("gecersiz biçimli beklenen ref: 503", async () => {
    for (const value of ["short", `${STAGING_REF.toUpperCase()}`, `${STAGING_REF}.evil`, "https://x.supabase.co"]) {
      configure({ EXPECTED_SUPABASE_PROJECT_REF: value });
      expect((await GET()).status).toBe(503);
      expect((await post()).status).toBe(503);
    }
    expect(state.calls).toEqual([]);
  });

  it("URL uyusmazligi: NEXT_PUBLIC_SUPABASE_URL baska host ise GET ve POST 503", async () => {
    configure({ NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co" });
    expect((await GET()).status).toBe(503);
    expect((await post()).status).toBe(503);
    expect(state.calls).toEqual([]);
  });

  it("eksik URL'ler: SUPABASE_URL veya NEXT_PUBLIC_SUPABASE_URL yoksa 503", async () => {
    configure({ NEXT_PUBLIC_SUPABASE_URL: undefined });
    expect((await GET()).status).toBe(503);
    configure({ SUPABASE_URL: undefined });
    expect((await post()).status).toBe(503);
    expect(state.calls).toEqual([]);
  });

  it("kandirmaca URL bicimleri reddedilir (alt alan adi, port, yol, kullanici bilgisi, http)", async () => {
    for (const url of [
      `${STAGING_URL}.evil.com`,
      `https://evil.com/${STAGING_REF}.supabase.co`,
      `${STAGING_URL}:8443`,
      `${STAGING_URL}/rest/v1`,
      `https://user:pw@${STAGING_REF}.supabase.co`,
      `http://${STAGING_REF}.supabase.co`,
      "not a url",
    ]) {
      configure({ SUPABASE_URL: url, NEXT_PUBLIC_SUPABASE_URL: url });
      expect((await GET()).status).toBe(503);
      expect((await post()).status).toBe(503);
    }
    expect(state.calls).toEqual([]);
  });

  it("503 govdesi ve loglar gizli deger ya da URL icermez", async () => {
    configure({ SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co", NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co" });
    const response = await post();
    const text = JSON.stringify(await response.json()) + JSON.stringify(vi.mocked(console.error).mock.calls);
    expect(text).not.toContain("test-service-key");
    expect(text).not.toContain("abcdefghijklmnopqrst");
  });
});

describe("bootstrap: hata ve kilit kurtarma", () => {
  async function bodyOf(response: Response) {
    return (await response.json()) as { ok?: boolean; error?: string; code?: string };
  }

  it("1) createUser başarısız: 400, kilit bırakılır, kullanıcı silme denenmez", async () => {
    state.fail.add("createUser");
    const response = await post();
    expect(response.status).toBe(400);
    expect(state.lock).toBe(false);
    expect(state.users).toBe(0);
    expect(state.calls.some((entry) => entry.startsWith("deleteUser"))).toBe(false);
  });

  it("1b) createUser ve kilit bırakma birlikte başarısız: 500 (yetim kilit açıkça bildirilir)", async () => {
    state.fail.add("createUser");
    state.fail.add("lockDelete");
    const response = await post();
    expect(response.status).toBe(500);
    expect((await bodyOf(response)).code).toBe("BOOTSTRAP_LOCK_STUCK");
    expect(state.lock).toBe(true);
  });

  it("2) owner_id güncellemesi başarısız: ASLA 201 dönmez; oluşturulan kullanıcı geri alınır, kilit bırakılır", async () => {
    state.fail.add("ownerUpdate");
    const response = await post();
    expect(response.status).toBe(500);
    expect((await bodyOf(response)).code).toBe("BOOTSTRAP_ROLLED_BACK");
    // Güncelleme 3 kez denenir; sonra yalnızca BU istekte oluşturulan kimlikle silinir.
    expect(state.calls.filter((entry) => entry === "update:workspace_bootstrap")).toHaveLength(3);
    expect(state.calls).toContain("deleteUser:new-user");
    expect(state.users).toBe(0);
    expect(state.lock).toBe(false);
  });

  it("2b) güncelleme 0 satır etkilerse (sahip zaten dolu/kilit yok) başarı sayılmaz, yeniden denenmez", async () => {
    state.fail.add("ownerZeroRows");
    const response = await post();
    expect(response.status).toBe(500);
    expect(state.calls.filter((entry) => entry === "update:workspace_bootstrap")).toHaveLength(1);
    expect(state.calls).toContain("deleteUser:new-user");
  });

  it("3) telafi başarısız (kullanıcı silinemedi): 500 ve kilit korunur; mesaj hassas bilgi içermez", async () => {
    state.fail.add("ownerUpdate");
    state.fail.add("deleteUser");
    const response = await post();
    const body = await bodyOf(response);
    expect(response.status).toBe(500);
    expect(body.code).toBe("BOOTSTRAP_OWNER_UNRECOVERED");
    expect(state.lock).toBe(true); // yeni bootstrap engelli kalır
    expect(state.users).toBe(1); // kullanıcı kaldı, elle müdahale gerekir
    expect(JSON.stringify(body)).not.toMatch(/new-user|sahte|test-service-key/);
    // Kilit bırakılmaya çalışılmaz (kullanıcı hâlâ var).
    expect(state.calls).not.toContain("delete:workspace_bootstrap");
  });

  it("4) telafi sonrası kilit bırakılamazsa: 500 (yetim kilit açıkça bildirilir, başarı yok)", async () => {
    state.fail.add("ownerUpdate");
    state.fail.add("lockDelete");
    const response = await post();
    expect(response.status).toBe(500);
    expect((await bodyOf(response)).code).toBe("BOOTSTRAP_LOCK_STUCK");
    expect(state.users).toBe(0);
    expect(state.lock).toBe(true);
  });

  it("5) sahiplik kaydı başarılıysa 201; owner_id oluşturulan kullanıcıdır, telafi çalışmaz", async () => {
    const response = await post();
    expect(response.status).toBe(201);
    expect(state.owner).toBe("new-user");
    expect(state.calls.some((entry) => entry.startsWith("deleteUser"))).toBe(false);
    expect(state.calls).not.toContain("delete:workspace_bootstrap");
  });

  it("6) kullanıcı zaten varsa yeni hesap oluşturulmaz ve mevcut kilit/kullanıcıya dokunulmaz", async () => {
    state.users = 1;
    const response = await post();
    expect(response.status).toBe(409);
    expect(state.calls).not.toContain("insert:workspace_bootstrap");
    expect(state.calls).not.toContain("createUser");
    expect(state.calls.some((entry) => entry.startsWith("deleteUser"))).toBe(false);
  });

  it("6b) kilit zaten varsa (başka bootstrap sürüyor) 409; o isteğin kilidi/kullanıcısı bozulmaz", async () => {
    state.lock = true;
    const response = await post();
    expect(response.status).toBe(409);
    expect(state.calls).not.toContain("createUser");
    expect(state.calls).not.toContain("delete:workspace_bootstrap");
    expect(state.lock).toBe(true);
  });

  it("7) eşzamanlı iki POST: en fazla bir başarılı bootstrap, tek kullanıcı, tek sahip", async () => {
    const [first, second] = await Promise.all([post({ email: "a@example.com", password: "secret1" }), post({ email: "b@example.com", password: "secret2" })]);
    expect([first.status, second.status].sort()).toEqual([201, 409]);
    expect(state.calls.filter((entry) => entry === "createUser")).toHaveLength(1);
    expect(state.users).toBe(1);
    expect(state.owner).toBe("new-user");
    expect(state.calls.some((entry) => entry.startsWith("deleteUser"))).toBe(false);
  });

  it("7b) eşzamanlı ve biri telafi gerektirirse bile iki hesap kalmaz", async () => {
    state.fail.add("ownerUpdate");
    const responses = await Promise.all([post({ email: "a@example.com", password: "secret1" }), post({ email: "b@example.com", password: "secret2" })]);
    expect(responses.map((response) => response.status).sort()).toEqual([409, 500]);
    expect(state.users).toBe(0);
    expect(state.owner).toBeNull();
  });

  it("8) yanlış proje ref'i: guard 503, hiçbir Supabase çağrısı yok (telafi/silme dahil)", async () => {
    configure({ SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co", NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co" });
    expect((await post()).status).toBe(503);
    expect(state.calls).toEqual([]);
  });

  it("9) eksik env: EXPECTED ref yok → 503; sunucu anahtarı yok → 503; hiçbirinde hesap oluşmaz", async () => {
    configure({ EXPECTED_SUPABASE_PROJECT_REF: undefined });
    expect((await post()).status).toBe(503);
    configure({ SUPABASE_SECRET_KEY: undefined });
    expect((await post()).status).toBe(503);
    expect(state.users).toBe(0);
    expect(state.calls).not.toContain("createUser");
  });

  it("sahipsiz kullanıcı onarımı bu pakette YOK: sahibi boş tek kullanıcı varken POST yine 409 (yetkisiz sahiplik edinilemez)", async () => {
    state.users = 1; // kullanıcı var, kilit satırı var, owner_id boş
    state.lock = true;
    const response = await post();
    expect(response.status).toBe(409);
    expect(state.owner).toBeNull();
    expect(state.calls).not.toContain("update:workspace_bootstrap");
  });
});

describe("bootstrap: koşullu kilit bırakma (F3) ve telafi istisnaları (F5)", () => {
  async function bodyOf(response: Response) {
    return (await response.json()) as { ok?: boolean; error?: string; code?: string };
  }
  const loggedText = () => JSON.stringify(vi.mocked(console.error).mock.calls);

  it("F3-1) createUser hatasında sahibi BOŞ kilit silinir (1 satır) ve 400 döner", async () => {
    state.fail.add("createUser");
    const response = await post();
    expect(response.status).toBe(400);
    expect(state.calls).toContain("delete:workspace_bootstrap");
    expect(state.lock).toBe(false);
  });

  it("F3-2) sahibi DOLU kilit silinmez: createUser hatasında silme 0 satır etkiler, kilit ve meşru sahip korunur", async () => {
    state.fail.add("createUser");
    state.fail.add("externalOwner"); // kilidin sahibi başka işlemce doldurulmuş
    const response = await post();
    expect(response.status).toBe(400); // "silinecek sahipsiz kilit yok" kilit-takıldı hatası sayılmaz
    expect(state.calls).toContain("delete:workspace_bootstrap"); // sorgu denendi ama koşul (owner_id IS NULL) eşleşmedi
    expect(state.lock).toBe(true);
    expect(state.owner).toBe("legit-owner");
  });

  it("F3-3) silinecek kilit yoksa (0 satır) durum 'none' sayılır: sahte 'kilit takıldı' hatası yok", async () => {
    state.fail.add("createUser");
    state.fail.add("lockVanishes");
    const response = await post();
    expect(response.status).toBe(400);
    expect((await bodyOf(response)).code).toBeUndefined();
    expect(state.lock).toBe(false);
  });

  it("F3-4) telafi sırasında meşru owner kaydı korunur: owner zaten dolu (conflict) → kullanıcı silinir, kilide DOKUNULMAZ", async () => {
    state.fail.add("externalOwner"); // createUser sonrası kilidin sahibi başka işlemce dolduruldu
    const response = await post();
    const body = await bodyOf(response);
    expect(response.status).toBe(500);
    expect(body.code).toBe("BOOTSTRAP_CONFLICT_ROLLED_BACK");
    expect(state.calls).toContain("deleteUser:new-user");
    expect(state.calls).not.toContain("delete:workspace_bootstrap");
    expect(state.lock).toBe(true);
    expect(state.owner).toBe("legit-owner");
  });

  it("F3-5) kilit silme sorgusu hata verirse kontrollü 500 (BOOTSTRAP_LOCK_STUCK), ayrıntı sızmaz", async () => {
    state.fail.add("createUser");
    state.fail.add("lockDelete");
    const response = await post();
    const body = await bodyOf(response);
    expect(response.status).toBe(500);
    expect(body.code).toBe("BOOTSTRAP_LOCK_STUCK");
    expect(JSON.stringify(body)).not.toMatch(/sahte|XX000/);
  });

  it("F5-1) deleteUser İSTİSNA atarsa: kontrollü 500 (UNRECOVERED), kilide dokunulmaz, istisna mesajı sızmaz", async () => {
    state.fail.add("ownerUpdate");
    state.fail.add("deleteUserThrow");
    const response = await post();
    const body = await bodyOf(response);
    expect(response.status).toBe(500);
    expect(body.code).toBe("BOOTSTRAP_OWNER_UNRECOVERED");
    expect(state.calls).not.toContain("delete:workspace_bootstrap");
    expect(state.lock).toBe(true);
    expect(JSON.stringify(body)).not.toMatch(/sahte|new-user/);
  });

  it("F5-2) releaseLock İSTİSNA atarsa (kullanıcı silindikten sonra): LOCK_STUCK, başka adım maskelenmez", async () => {
    state.fail.add("ownerUpdate");
    state.fail.add("lockDeleteThrow");
    const response = await post();
    expect((await bodyOf(response)).code).toBe("BOOTSTRAP_LOCK_STUCK");
    expect(state.calls).toContain("deleteUser:new-user"); // kullanıcı silme, kilit istisnasından ÖNCE tamamlandı
    expect(state.users).toBe(0);
  });

  it("F5-3) recordOwner İSTİSNA atarsa: 3 deneme sonrası telafi çalışır (kullanıcı silinir, kilit bırakılır), 201 yok", async () => {
    state.fail.add("ownerUpdateThrow");
    const response = await post();
    expect(response.status).toBe(500);
    expect((await bodyOf(response)).code).toBe("BOOTSTRAP_ROLLED_BACK");
    expect(state.calls.filter((entry) => entry === "update:workspace_bootstrap")).toHaveLength(3);
    expect(state.calls).toContain("deleteUser:new-user");
    expect(state.lock).toBe(false);
  });

  it("F5-4) bir telafi adımının hatası diğerini atlatmaz: deleteUser hata + kilit hata birlikte → tek, açık kod", async () => {
    state.fail.add("ownerUpdate");
    state.fail.add("deleteUser");
    state.fail.add("lockDelete");
    const response = await post();
    expect((await bodyOf(response)).code).toBe("BOOTSTRAP_OWNER_UNRECOVERED");
    expect(state.calls).not.toContain("delete:workspace_bootstrap"); // kullanıcı kaldıysa kilide dokunulmaz
  });

  it("F5-5) hata günlükleri şifre, e-posta, anahtar, yığın izi veya iç hata iletisi içermez", async () => {
    state.fail.add("ownerUpdateThrow");
    state.fail.add("deleteUserThrow");
    await post({ email: "gizli@example.com", password: "cok-gizli-sifre" });
    const text = loggedText();
    expect(text).not.toMatch(/cok-gizli-sifre|gizli@example\.com|test-service-key|Bearer|authorization/i);
    expect(text).not.toMatch(/\bat\s+\S+\s+\(|stack/i);
    expect(text).not.toMatch(/sahte/); // sahte istisna İLETİLERİ yazılmaz, yalnız hata adı
    expect(text).toContain("errorName");
  });

  it("F5-6) başarılı bootstrap regresyonu: 201, owner yazıldı, telafi/kilit silme çalışmaz", async () => {
    const response = await post();
    expect(response.status).toBe(201);
    expect(state.owner).toBe("new-user");
    expect(state.calls).not.toContain("delete:workspace_bootstrap");
    expect(state.calls.some((entry) => entry.startsWith("deleteUser"))).toBe(false);
  });
});

describe("bootstrap: createUser hatasında ham sağlayıcı mesajı istemciye dönmez (B1)", () => {
  const SAFE = "Hesap oluşturulamadı. E-posta ve şifrenizi kontrol edip tekrar deneyin.";
  const loggedText = () => JSON.stringify(vi.mocked(console.error).mock.calls);

  it("B1-1) createUser {error} döndürürse yanıt sabit güvenli mesajdır; sağlayıcı iletisi, kodu ve ayrıntısı yoktur", async () => {
    state.fail.add("createUser");
    const response = await post();
    const body = (await response.json()) as { error?: string; code?: string };
    expect(response.status).toBe(400);
    expect(body).toEqual({ error: SAFE });
    expect(JSON.stringify(body)).not.toMatch(/Database error|sahte|saglayici|hesap@ornek|unexpected_failure|500/);
  });

  it("B1-2) kullanıcı da hata da dönmezse aynı sabit güvenli mesaj döner", async () => {
    state.fail.add("createUserNoUser");
    const response = await post();
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: SAFE });
    expect(state.lock).toBe(false); // mevcut lock davranışı korunur
  });

  it("B1-3) hata günlüğü yalnız kod/durum içerir: ham ileti, e-posta, şifre yok", async () => {
    state.fail.add("createUser");
    await post({ email: "gizli@example.com", password: "cok-gizli-sifre" });
    const text = loggedText();
    expect(text).toContain("unexpected_failure"); // güvenli tanılama alanı
    expect(text).not.toMatch(/Database error|sahte-saglayici|hesap@ornek|gizli@example\.com|cok-gizli-sifre|test-service-key/);
  });

  it("B1-4) createUser İSTİSNA atarsa mevcut davranış korunur: genel 500, istisna ayrıntısı sızmaz", async () => {
    state.fail.add("createUserThrow");
    const response = await post();
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "İlk hesap oluşturulamadı." });
    expect(loggedText()).not.toMatch(/sahte-istisna|gizli-host/);
  });

  it("B1-5) mevcut lock/telafi akışı bozulmadı: createUser hatası + lock bırakma hatası hâlâ LOCK_STUCK", async () => {
    state.fail.add("createUser");
    state.fail.add("lockDelete");
    const response = await post();
    const body = (await response.json()) as { code?: string; error?: string };
    expect(response.status).toBe(500);
    expect(body.code).toBe("BOOTSTRAP_LOCK_STUCK");
    expect(body.error).not.toMatch(/Database error|sahte/);
  });
});
