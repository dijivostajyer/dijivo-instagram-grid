import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Takvim API yetkilendirme testleri. Gerçek Supabase'e bağlanılmaz: sahte istemci iki kullanıcıyı
 * (A ve B), onların marka/planlarını ve takvim kayıtlarını bellekte tutar. Takvim deposu
 * service-role ile (RLS'siz) çalıştığı için asıl koruma route'larda uygulanan kimlik + sahiplik kontrolüdür.
 */
type Row = Record<string, unknown>;
const db = vi.hoisted(() => ({
  tokens: {} as Record<string, string>,
  tables: {} as Record<string, Row[]>,
  failBrandLookup: false,
  failPostLookup: false,
  failCalendarWrite: false,
  serviceCalls: [] as string[],
  /** Yazma katmanına (insert/update/delete) giden GERÇEK yükler ve süzgeçler. */
  writes: [] as Array<{ table: string; op: string; payload: Record<string, unknown>; filters: Array<[string, unknown]> }>,
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: {
      getUser: async (token: string) => {
        const id = db.tokens[token];
        return id ? { data: { user: { id } }, error: null } : { data: { user: null }, error: { message: "invalid token" } };
      },
    },
    from(table: string) {
      let op: "select" | "insert" | "update" | "delete" = "select";
      let payload: Row = {};
      const filters: Array<[string, unknown]> = [];
      const matching = () => (db.tables[table] ?? []).filter((row) => filters.every(([column, value]) => row[column] === value));
      const execute = () => {
        db.serviceCalls.push(`${op}:${table}`);
        if (op !== "select") db.writes.push({ table, op, payload: { ...payload }, filters: [...filters] });
        if (table === "workspace_brands" && db.failBrandLookup) return { data: null, error: { code: "XX000", message: "boom" } };
        if (table === "calendar_items" && db.failCalendarWrite && op !== "select") return { data: null, error: { code: "XX000", message: "db-yazma-hatasi-ayrintisi" } };
        if (table === "workspace_posts" && db.failPostLookup) return { data: null, error: { code: "XX000", message: "boom-post" } };
        const rows = db.tables[table] ?? (db.tables[table] = []);
        if (op === "insert") {
          rows.push({ ...payload });
          return { data: [payload], error: null };
        }
        if (op === "update") {
          const hit = matching();
          for (const row of hit) Object.assign(row, payload);
          return { data: hit, error: null };
        }
        if (op === "delete") {
          const hit = matching();
          db.tables[table] = rows.filter((row) => !hit.includes(row));
          return { data: null, error: null, count: hit.length };
        }
        return { data: matching(), error: null };
      };
      const builder: Record<string, unknown> = {
        select: () => builder,
        insert: (row: Row) => { op = "insert"; payload = row; return builder; },
        update: (patch: Row) => { op = "update"; payload = patch; return builder; },
        delete: () => { op = "delete"; return builder; },
        eq: (column: string, value: unknown) => { filters.push([column, value]); return builder; },
        order: () => builder,
        maybeSingle: async () => {
          const result = execute() as { data: Row[] | null; error: unknown };
          return { data: result.data?.[0] ?? null, error: result.error };
        },
        then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(execute()).then(resolve, reject),
      };
      return builder;
    },
  }),
}));

import { GET as brandItemsGet } from "./brand-items/route";
import { DELETE, PATCH } from "./items/[id]/route";
import { GET as itemsGet, POST as itemsPost } from "./items/route";

const A = "Bearer tok-a";
const B = "Bearer tok-b";

function item(id: string, brandId: string, projectId: string, title: string): Row {
  return {
    id, brand_id: brandId, project_id: projectId, post_id: null, item_type: "post", title, description: "",
    scheduled_at: "2026-12-15T10:00:00.000Z", status: "planned", checklist: [],
    created_at: "2026-11-01T00:00:00.000Z", updated_at: "2026-11-01T00:00:00.000Z",
  };
}

function call(path: string, method: string, authorization: string | null, body?: unknown) {
  return new Request(`https://app.test${path}`, {
    method,
    headers: { ...(authorization ? { authorization } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const validBody = (brandId: string, projectId: string) => ({
  brandId, projectId, postId: null, itemType: "post", title: "Test", description: "", scheduledAt: "2026-12-20T09:00:00.000Z", status: "draft", checklist: [],
});
const titlesOf = (brandId: string) => (db.tables.calendar_items ?? []).filter((row) => row.brand_id === brandId).map((row) => row.title);

beforeEach(() => {
  process.env.SUPABASE_URL = "https://proj.supabase.co";
  process.env.SUPABASE_SECRET_KEY = "test-service-key";
  db.tokens = { "tok-a": "user-a", "tok-b": "user-b" };
  db.failBrandLookup = false;
  db.failPostLookup = false;
  db.failCalendarWrite = false;
  db.serviceCalls = [];
  db.writes = [];
  db.tables = {
    workspace_brands: [{ id: "brand-a", user_id: "user-a" }, { id: "brand-b", user_id: "user-b" }],
    workspace_projects: [
      { id: "proj-a", brand_id: "brand-a", user_id: "user-a" },
      { id: "proj-b", brand_id: "brand-b", user_id: "user-b" },
    ],
    workspace_posts: [
      { id: "post-a", brand_id: "brand-a", user_id: "user-a" },
      { id: "post-b", brand_id: "brand-b", user_id: "user-b" },
    ],
    calendar_items: [item("item-a", "brand-a", "proj-a", "A kaydı"), item("item-b", "brand-b", "proj-b", "B kaydı")],
  };
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("takvim API: oturum zorunluluğu", () => {
  it("1) oturumsuz GET /items → 401, veri okunmaz", async () => {
    const response = await itemsGet(call("/api/calendar/items?brandId=brand-a&projectId=proj-a", "GET", null));
    expect(response.status).toBe(401);
    expect(db.serviceCalls.filter((entry) => entry.endsWith("calendar_items"))).toEqual([]);
  });

  it("1b) geçersiz token → 401", async () => {
    const response = await itemsGet(call("/api/calendar/items?brandId=brand-a&projectId=proj-a", "GET", "Bearer sahte"));
    expect(response.status).toBe(401);
  });

  it("1c) oturumsuz GET /brand-items → 401", async () => {
    expect((await brandItemsGet(call("/api/calendar/brand-items?brandId=brand-a", "GET", null))).status).toBe(401);
  });

  it("2) oturumsuz POST → 401, kayıt oluşmaz", async () => {
    const response = await itemsPost(call("/api/calendar/items", "POST", null, validBody("brand-a", "proj-a")));
    expect(response.status).toBe(401);
    expect(titlesOf("brand-a")).toEqual(["A kaydı"]);
  });

  it("3) oturumsuz PATCH → 401, kayıt değişmez", async () => {
    const response = await PATCH(call("/api/calendar/items/item-a?brandId=brand-a", "PATCH", null, { title: "Hacklendi" }), ctx("item-a"));
    expect(response.status).toBe(401);
    expect(titlesOf("brand-a")).toEqual(["A kaydı"]);
  });

  it("4) oturumsuz DELETE → 401, kayıt silinmez", async () => {
    const response = await DELETE(call("/api/calendar/items/item-a?brandId=brand-a", "DELETE", null), ctx("item-a"));
    expect(response.status).toBe(401);
    expect(titlesOf("brand-a")).toEqual(["A kaydı"]);
  });

  it("sunucu yapılandırması yoksa 503 (kimlik doğrulaması atlanmaz)", async () => {
    delete process.env.SUPABASE_URL;
    expect((await itemsGet(call("/api/calendar/items?brandId=brand-a&projectId=proj-a", "GET", A))).status).toBe(503);
  });
});

describe("takvim API: kullanıcı A/B izolasyonu", () => {
  it("5) A, B'nin markasını okuyamaz (items ve brand-items); veri sızmaz", async () => {
    const list = await itemsGet(call("/api/calendar/items?brandId=brand-b&projectId=proj-b", "GET", A));
    expect(list.status).toBe(404);
    expect(JSON.stringify(await list.json())).not.toContain("B kaydı");
    const all = await brandItemsGet(call("/api/calendar/brand-items?brandId=brand-b", "GET", A));
    expect(all.status).toBe(404);
    expect(JSON.stringify(await all.json())).not.toContain("B kaydı");
  });

  it("6) A, B'nin markasına takvim kaydı ekleyemez", async () => {
    const response = await itemsPost(call("/api/calendar/items", "POST", A, validBody("brand-b", "proj-b")));
    expect(response.status).toBe(404);
    expect(titlesOf("brand-b")).toEqual(["B kaydı"]);
  });

  it("7) A, B'nin kaydını güncelleyemez (hem B'nin markasıyla hem kendi markasıyla deneme)", async () => {
    const viaBrandB = await PATCH(call("/api/calendar/items/item-b?brandId=brand-b", "PATCH", A, { title: "Hacklendi" }), ctx("item-b"));
    expect(viaBrandB.status).toBe(404);
    const viaOwnBrand = await PATCH(call("/api/calendar/items/item-b?brandId=brand-a", "PATCH", A, { title: "Hacklendi" }), ctx("item-b"));
    expect(viaOwnBrand.status).toBe(404);
    expect(titlesOf("brand-b")).toEqual(["B kaydı"]);
  });

  it("8) A, B'nin kaydını silemez (hem B'nin markasıyla hem kendi markasıyla deneme)", async () => {
    const viaBrandB = await DELETE(call("/api/calendar/items/item-b?brandId=brand-b", "DELETE", A), ctx("item-b"));
    expect(viaBrandB.status).toBe(404);
    const viaOwnBrand = await DELETE(call("/api/calendar/items/item-b?brandId=brand-a", "DELETE", A), ctx("item-b"));
    expect(viaOwnBrand.status).toBe(404);
    expect(titlesOf("brand-b")).toEqual(["B kaydı"]);
  });

  it("9) kullanıcının kendi markasındaki geçerli işlemler çalışır (listele, ekle, güncelle, sil)", async () => {
    const list = await itemsGet(call("/api/calendar/items?brandId=brand-a&projectId=proj-a", "GET", A));
    expect(list.status).toBe(200);
    expect((await list.json()).items.map((entry: { title: string }) => entry.title)).toEqual(["A kaydı"]);

    const all = await brandItemsGet(call("/api/calendar/brand-items?brandId=brand-a", "GET", A));
    expect(all.status).toBe(200);

    const created = await itemsPost(call("/api/calendar/items", "POST", A, validBody("brand-a", "proj-a")));
    expect(created.status).toBe(201);
    const newId = (await created.json()).item.id as string;

    const patched = await PATCH(call(`/api/calendar/items/${newId}?brandId=brand-a`, "PATCH", A, { title: "Yeni başlık" }), ctx(newId));
    expect(patched.status).toBe(200);
    expect(titlesOf("brand-a")).toContain("Yeni başlık");

    const removed = await DELETE(call(`/api/calendar/items/${newId}?brandId=brand-a`, "DELETE", A), ctx(newId));
    expect(removed.status).toBe(204);
    expect(titlesOf("brand-a")).toEqual(["A kaydı"]);
  });

  it("9b) B de kendi markasını yönetebilir (kullanıcılar birbirini engellemez)", async () => {
    const list = await itemsGet(call("/api/calendar/items?brandId=brand-b&projectId=proj-b", "GET", B));
    expect(list.status).toBe(200);
    expect((await list.json()).items).toHaveLength(1);
  });
});

describe("takvim API: plan–marka tutarlılığı ve girdi doğrulaması", () => {
  it("10) başka markaya ait projectId ile GET ve POST reddedilir", async () => {
    // proj-b, B'nin markasına ait; A kendi markasıyla (brand-a) onu kullanamaz.
    const list = await itemsGet(call("/api/calendar/items?brandId=brand-a&projectId=proj-b", "GET", A));
    expect(list.status).toBe(404);
    const create = await itemsPost(call("/api/calendar/items", "POST", A, validBody("brand-a", "proj-b")));
    expect(create.status).toBe(404);
    expect(titlesOf("brand-a")).toEqual(["A kaydı"]);
    expect(titlesOf("brand-b")).toEqual(["B kaydı"]);
  });

  it("10b) var olmayan marka/plan 404 (sahip olunmayanla aynı yanıt, bilgi sızdırmaz)", async () => {
    const missingProject = await itemsGet(call("/api/calendar/items?brandId=brand-a&projectId=yok", "GET", A));
    const missingBrand = await itemsGet(call("/api/calendar/items?brandId=yok&projectId=proj-a", "GET", A));
    const foreign = await itemsGet(call("/api/calendar/items?brandId=brand-b&projectId=proj-b", "GET", A));
    expect([missingProject.status, missingBrand.status, foreign.status]).toEqual([404, 404, 404]);
    expect(await missingBrand.json()).toEqual(await foreign.json());
  });

  it("11) eksik/geçersiz parametreler kontrollü 400 döner (oturumlu)", async () => {
    expect((await itemsGet(call("/api/calendar/items?projectId=proj-a", "GET", A))).status).toBe(400);
    expect((await itemsGet(call("/api/calendar/items?brandId=brand-a", "GET", A))).status).toBe(400);
    expect((await brandItemsGet(call("/api/calendar/brand-items", "GET", A))).status).toBe(400);
    expect((await PATCH(call("/api/calendar/items/item-a", "PATCH", A, { title: "x" }), ctx("item-a"))).status).toBe(400);
    expect((await DELETE(call("/api/calendar/items/item-a", "DELETE", A), ctx("item-a"))).status).toBe(400);
    const emptyIds = await itemsPost(call("/api/calendar/items", "POST", A, { ...validBody("", ""), title: "x" }));
    expect(emptyIds.status).toBe(400);
    const notAnObject = await itemsPost(call("/api/calendar/items", "POST", A, "metin"));
    expect(notAnObject.status).toBe(400);
  });

  it("yetki veritabanı hatası güvenli 500 döner ve iç hata sızdırmaz", async () => {
    db.failBrandLookup = true;
    const response = await itemsGet(call("/api/calendar/items?brandId=brand-a&projectId=proj-a", "GET", A));
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("boom");
  });
});

describe("takvim API: postId sahipliği ve geçersiz JSON (F7)", () => {
  const withPost = (postId: unknown) => ({ ...validBody("brand-a", "proj-a"), postId });
  const rawPost = (raw: string, authorization: string | null = A) =>
    itemsPost(new Request("https://app.test/api/calendar/items", { method: "POST", headers: { ...(authorization ? { authorization } : {}), "content-type": "application/json" }, body: raw }));

  it("kendi markasına ait postId ile kayıt oluşturulur", async () => {
    const response = await itemsPost(call("/api/calendar/items", "POST", A, withPost("post-a")));
    expect(response.status).toBe(201);
    expect((await response.json()).item.postId).toBe("post-a");
  });

  it("başka kullanıcının/markanın postId'si reddedilir (400), kayıt yazılmaz", async () => {
    const before = titlesOf("brand-a").length;
    const response = await itemsPost(call("/api/calendar/items", "POST", A, withPost("post-b")));
    expect(response.status).toBe(400);
    expect(JSON.stringify(await response.json())).not.toContain("brand-b");
    expect(titlesOf("brand-a")).toHaveLength(before);
  });

  it("aynı kullanıcıya ait ama BAŞKA markadaki postId de bu markaya bağlanamaz", async () => {
    db.tables.workspace_posts.push({ id: "post-a-other-brand", brand_id: "brand-a2", user_id: "user-a" });
    const response = await itemsPost(call("/api/calendar/items", "POST", A, withPost("post-a-other-brand")));
    expect(response.status).toBe(400);
  });

  it("bulunamayan postId fail-closed reddedilir (var olmayan ve başkasına ait aynı yanıt)", async () => {
    const missing = await itemsPost(call("/api/calendar/items", "POST", A, withPost("yok-boyle-post")));
    const foreign = await itemsPost(call("/api/calendar/items", "POST", A, withPost("post-b")));
    expect(missing.status).toBe(400);
    expect(await missing.json()).toEqual(await foreign.json());
  });

  it("opsiyonel postId: null, yok ve boş string mevcut davranışı bozmaz (gönderi sorgusu yapılmaz)", async () => {
    for (const postId of [null, undefined, "", "  "]) {
      db.serviceCalls = [];
      const response = await itemsPost(call("/api/calendar/items", "POST", A, withPost(postId)));
      expect(response.status).toBe(201);
      expect(db.serviceCalls).not.toContain("select:workspace_posts");
    }
  });

  it("gönderi sorgusu hata verirse kontrollü 500 (yazma yok), iç hata sızmaz", async () => {
    db.failPostLookup = true;
    const before = titlesOf("brand-a").length;
    const response = await itemsPost(call("/api/calendar/items", "POST", A, withPost("post-a")));
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("boom");
    expect(titlesOf("brand-a")).toHaveLength(before);
  });

  it("PATCH ile de başka markanın postId'sine bağlanamaz; kendi postId'si bağlanabilir", async () => {
    const bad = await PATCH(call("/api/calendar/items/item-a?brandId=brand-a", "PATCH", A, { postId: "post-b" }), ctx("item-a"));
    expect(bad.status).toBe(400);
    const good = await PATCH(call("/api/calendar/items/item-a?brandId=brand-a", "PATCH", A, { postId: "post-a" }), ctx("item-a"));
    expect(good.status).toBe(200);
  });

  it("geçersiz JSON gövdesi POST'ta 400 (500 değil)", async () => {
    const response = await rawPost("{bozuk json");
    expect(response.status).toBe(400);
    expect(JSON.stringify(await response.json())).not.toMatch(/Unexpected|JSON|stack/i);
  });

  it("geçersiz JSON gövdesi PATCH'te 400 (500 değil)", async () => {
    const response = await PATCH(new Request("https://app.test/api/calendar/items/item-a?brandId=brand-a", { method: "PATCH", headers: { authorization: A, "content-type": "application/json" }, body: "{bozuk" }), ctx("item-a"));
    expect(response.status).toBe(400);
  });

  it("geçerli JSON ama eksik zorunlu alan 400", async () => {
    const missingTitle = await itemsPost(call("/api/calendar/items", "POST", A, { ...validBody("brand-a", "proj-a"), title: "" }));
    expect(missingTitle.status).toBe(400);
  });

  it("veritabanı yazma hatası (POST, PATCH, DELETE) kontrollü 500: ayrıntı sızmaz, kayıtlar değişmez", async () => {
    db.failCalendarWrite = true;
    const created = await itemsPost(call("/api/calendar/items", "POST", A, validBody("brand-a", "proj-a")));
    const patched = await PATCH(call("/api/calendar/items/item-a?brandId=brand-a", "PATCH", A, { title: "Yeni" }), ctx("item-a"));
    const removed = await DELETE(call("/api/calendar/items/item-a?brandId=brand-a", "DELETE", A), ctx("item-a"));
    for (const response of [created, patched, removed]) {
      expect(response.status).toBe(500);
      expect(JSON.stringify(await response.json())).not.toMatch(/db-yazma|XX000|stack/);
    }
    expect(titlesOf("brand-a")).toEqual(["A kaydı"]);
  });

  it("geçersiz JSON da önce oturum ister: oturumsuz geçersiz gövde 401", async () => {
    expect((await rawPost("{bozuk", null)).status).toBe(401);
  });
});

const calendarWrites = () => db.writes.filter((write) => write.table === "calendar_items");
const itemRow = (id: string) => (db.tables.calendar_items ?? []).find((row) => row.id === id) as Record<string, unknown>;
const patchItem = (body: unknown, id = "item-a", brand = "brand-a", authorization: string | null = A) =>
  PATCH(call(`/api/calendar/items/${id}?brandId=${brand}`, "PATCH", authorization, body), ctx(id));

describe("takvim API PATCH: mass-assignment koruması (N2): yazma katmanına giden alanlar", () => {
  // Seçilen yaklaşım: korumalı alanlar YOK SAYILIR (allowlist). Yalnız bilinen alanlar yazılır; yanıt 200 döner.
  it("brand_id, project_id, id, user_id (snake ve camelCase) gövdede olsa bile yazma yüküne GİRMEZ; kayıt ve filtre değişmez", async () => {
    const response = await patchItem({
      title: "Yeni başlık",
      brand_id: "brand-b", brandId: "brand-b",
      project_id: "proj-b", projectId: "proj-b",
      id: "hirsiz-id", user_id: "user-b", userId: "user-b",
      created_at: "1999-01-01T00:00:00.000Z",
    });
    expect(response.status).toBe(200);
    const writes = calendarWrites();
    expect(writes).toHaveLength(1);
    expect(writes[0].op).toBe("update");
    // Yazma katmanına yalnız izinli alan (title) ve updated_at gitti:
    expect(Object.keys(writes[0].payload).sort()).toEqual(["title", "updated_at"]);
    for (const forbidden of ["brand_id", "brandId", "project_id", "projectId", "id", "user_id", "userId", "created_at"]) {
      expect(writes[0].payload).not.toHaveProperty(forbidden);
    }
    // Hedef kayıt yalnız yetkili markanın kapsamında seçildi (id + brand_id süzgeci):
    expect(writes[0].filters).toEqual([["id", "item-a"], ["brand_id", "brand-a"]]);
    // Gerçek kayıt: sahiplik/kapsam alanları değişmedi, meşru alan yazıldı.
    const row = itemRow("item-a");
    expect(row.brand_id).toBe("brand-a");
    expect(row.project_id).toBe("proj-a");
    expect(row.id).toBe("item-a");
    expect(row).not.toHaveProperty("user_id");
    expect(row.title).toBe("Yeni başlık");
    // B kullanıcısının kaydı etkilenmedi.
    expect(itemRow("item-b").title).toBe("B kaydı");
  });

  it("yalnız korumalı alanlar gönderilirse yazma yapılmaz ve 400 döner (güncellenecek alan yok)", async () => {
    const response = await patchItem({ brand_id: "brand-b", project_id: "proj-b", id: "x", user_id: "user-b" });
    expect(response.status).toBe(400);
    expect(calendarWrites()).toEqual([]);
    expect(itemRow("item-a").brand_id).toBe("brand-a");
  });

  it("meşru PATCH alanlarının hepsi yazılmaya devam eder (allowlist gereksiz daraltılmamış)", async () => {
    const checklist = [{ id: "c1", label: "Madde", done: false }];
    const response = await patchItem({
      title: "T", description: "D", scheduledAt: "2026-12-30T08:00:00.000Z", status: "published", itemType: "reel", checklist, postId: "post-a",
    });
    expect(response.status).toBe(200);
    const [write] = calendarWrites();
    expect(write.payload).toMatchObject({
      title: "T", description: "D", scheduled_at: "2026-12-30T08:00:00.000Z", status: "published", item_type: "reel", checklist, post_id: "post-a",
    });
    expect(Object.keys(write.payload).sort()).toEqual(["checklist", "description", "item_type", "post_id", "scheduled_at", "status", "title", "updated_at"]);
  });

  it("başka kullanıcının kaydına/markasına gönderilen korumalı alanlar da hiçbir yazma üretmez", async () => {
    const response = await patchItem({ title: "Hacklendi", brand_id: "brand-a" }, "item-b", "brand-b");
    expect(response.status).toBe(404);
    expect(calendarWrites()).toEqual([]);
    expect(itemRow("item-b").title).toBe("B kaydı");
  });
});

const NON_STRING_POST_IDS: Array<[string, unknown]> = [
  ["123", 123], ["0", 0], ["true", true], ["false", false], ["{}", {}], ["[]", []], ["[post-a]", ["post-a"]], ["{id: post-a}", { id: "post-a" }],
];

describe("takvim API postId türleri (N1/N3): PATCH", () => {
  it.each(NON_STRING_POST_IDS)("dize dışı postId (%s) 400 döner; hiçbir DB yazması ve gönderi sorgusu yapılmaz", async (_label, value) => {
    const response = await patchItem({ postId: value });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("Geçersiz gönderi bağlantısı.");
    expect(calendarWrites()).toEqual([]);
    expect(db.serviceCalls).not.toContain("select:workspace_posts"); // tür hatasında sahiplik sorgusuna bile gidilmez
    expect(itemRow("item-a")).not.toHaveProperty("post_id", value);
  });

  it("postId: null bağlantıyı KALDIRIR (unlink): yazma yüküne post_id: null girer, sahiplik sorgusu gerekmez", async () => {
    itemRow("item-a").post_id = "post-a";
    const response = await patchItem({ postId: null });
    expect(response.status).toBe(200);
    const [write] = calendarWrites();
    expect(write.payload).toHaveProperty("post_id", null);
    expect(itemRow("item-a").post_id).toBeNull();
    expect(db.serviceCalls).not.toContain("select:workspace_posts");
  });

  it("postId hiç gönderilmezse mevcut bağlantı korunur ve yazma yüküne post_id girmez", async () => {
    itemRow("item-a").post_id = "post-a";
    const response = await patchItem({ title: "Sadece başlık" });
    expect(response.status).toBe(200);
    const [write] = calendarWrites();
    expect(write.payload).not.toHaveProperty("post_id");
    expect(itemRow("item-a").post_id).toBe("post-a");
  });

  it("geçerli (kendi markasına ait) dize postId: sahiplik sorgusu çalışır ve değer yazılır", async () => {
    const response = await patchItem({ postId: "post-a" });
    expect(response.status).toBe(200);
    expect(db.serviceCalls).toContain("select:workspace_posts");
    expect(calendarWrites()[0].payload).toHaveProperty("post_id", "post-a");
  });

  it("başka markaya/kullanıcıya ait dize postId aynı bilgi sızdırmayan 400 ile reddedilir ve yazma yapılmaz", async () => {
    const foreign = await patchItem({ postId: "post-b" });
    const missing = await patchItem({ postId: "yok-boyle-post" });
    expect(foreign.status).toBe(400);
    expect(missing.status).toBe(400);
    expect(await foreign.json()).toEqual(await missing.json());
    expect(calendarWrites()).toEqual([]);
  });
});

describe("takvim API postId türleri (N1/N3): POST (PATCH ile tutarlı)", () => {
  const bodyWith = (postId: unknown) => ({ ...validBody("brand-a", "proj-a"), postId });

  it.each(NON_STRING_POST_IDS)("dize dışı postId (%s) 400 döner; insert ve gönderi sorgusu yapılmaz (String(...) ile dönüştürülmez)", async (_label, value) => {
    const response = await itemsPost(call("/api/calendar/items", "POST", A, bodyWith(value)));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("Geçersiz gönderi bağlantısı.");
    expect(calendarWrites()).toEqual([]);
    expect(db.serviceCalls).not.toContain("select:workspace_posts");
    expect(titlesOf("brand-a")).toEqual(["A kaydı"]);
  });

  it("null ve eksik postId mevcut davranışı korur (201, post_id null); geçerli dize doğrulanıp yazılır", async () => {
    const withNull = await itemsPost(call("/api/calendar/items", "POST", A, bodyWith(null)));
    expect(withNull.status).toBe(201);
    const absent = await itemsPost(call("/api/calendar/items", "POST", A, validBody("brand-a", "proj-a")));
    expect(absent.status).toBe(201);
    const inserts = calendarWrites().filter((write) => write.op === "insert");
    expect(inserts).toHaveLength(2);
    for (const write of inserts) expect(write.payload.post_id).toBeNull();
    db.writes = [];
    db.serviceCalls = [];
    const valid = await itemsPost(call("/api/calendar/items", "POST", A, bodyWith("post-a")));
    expect(valid.status).toBe(201);
    expect(db.serviceCalls).toContain("select:workspace_posts");
    expect(calendarWrites()[0].payload.post_id).toBe("post-a");
  });

  it("başka markaya/kullanıcıya ait dize postId reddedilir (400, yazma yok)", async () => {
    const response = await itemsPost(call("/api/calendar/items", "POST", A, bodyWith("post-b")));
    expect(response.status).toBe(400);
    expect(calendarWrites()).toEqual([]);
  });
});
