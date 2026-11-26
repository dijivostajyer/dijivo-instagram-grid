import { beforeEach, describe, expect, it, vi } from "vitest";

const TOKEN_A = "11111111-1111-4111-8111-111111111111";
const TOKEN_B = "22222222-2222-4222-8222-222222222222";
const TOKEN_LEGACY = "33333333-3333-4333-8333-333333333333";

const world = vi.hoisted(() => ({
  tokens: {} as Record<string, string>,
  brands: [] as Array<{ id: string; user_id: string }>,
  ownerId: null as string | null,
  snapshots: new Map<string, { context?: { brandId?: string } }>(),
  revoked: new Set<string>(),
}));

vi.mock("@/lib/share-store", () => ({
  getShareStore: () => ({
    peek: async (token: string) => (world.revoked.has(token) ? null : world.snapshots.get(token) ?? null),
    revoke: async (token: string) => { world.revoked.add(token); },
  }),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: {
      getUser: async (token: string) => {
        const id = world.tokens[token];
        return id ? { data: { user: { id } }, error: null } : { data: { user: null }, error: { message: "x" } };
      },
    },
    from: (table: string) => {
      const filters: Array<[string, unknown]> = [];
      const builder = {
        select: () => builder,
        eq: (column: string, value: unknown) => { filters.push([column, value]); return builder; },
        maybeSingle: async () => {
          if (table === "workspace_brands") return { data: world.brands.find((row) => filters.every(([c, v]) => (row as Record<string, unknown>)[c] === v)) ?? null, error: null };
          if (table === "workspace_bootstrap") return { data: world.ownerId ? { owner_id: world.ownerId } : null, error: null };
          return { data: null, error: null };
        },
      };
      return builder;
    },
  }),
}));

import { DELETE } from "./route";

const call = (token: string, authorization: string | null) =>
  DELETE(new Request(`https://app.test/api/shares/${token}`, { method: "DELETE", headers: authorization ? { authorization } : {} }), { params: Promise.resolve({ token }) });

beforeEach(() => {
  process.env.SUPABASE_URL = "https://proj.supabase.co";
  process.env.SUPABASE_SECRET_KEY = "test-service-key";
  world.tokens = { "tok-a": "user-a", "tok-b": "user-b" };
  world.brands = [{ id: "brand-a", user_id: "user-a" }, { id: "brand-b", user_id: "user-b" }];
  world.ownerId = "user-a"; // çalışma alanı sahibi A
  world.snapshots = new Map([
    [TOKEN_A, { context: { brandId: "brand-a" } }],
    [TOKEN_B, { context: { brandId: "brand-b" } }],
    [TOKEN_LEGACY, {}], // bağlamı olmayan eski kayıt
  ]);
  world.revoked = new Set();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("DELETE /api/shares/[token]: sahiplik", () => {
  it("1) oturumsuz → 401, iptal edilmez", async () => {
    expect((await call(TOKEN_A, null)).status).toBe(401);
    expect((await call(TOKEN_A, "Bearer sahte")).status).toBe(401);
    expect(world.revoked.size).toBe(0);
  });

  it("2) A, B'nin paylaşımını iptal edemez (404, bilgi sızdırmaz)", async () => {
    const response = await call(TOKEN_B, "Bearer tok-a");
    expect(response.status).toBe(404);
    expect(world.revoked.has(TOKEN_B)).toBe(false);
    const missing = await call("44444444-4444-4444-8444-444444444444", "Bearer tok-a");
    expect(await response.json()).toEqual(await missing.json()); // var olmayanla aynı yanıt
  });

  it("3) A kendi paylaşımını iptal eder; sonrasında snapshot görüntülenemez (peek null)", async () => {
    const response = await call(TOKEN_A, "Bearer tok-a");
    expect(response.status).toBe(200);
    expect(world.revoked.has(TOKEN_A)).toBe(true);
    const again = await call(TOKEN_A, "Bearer tok-a");
    expect(again.status).toBe(404); // iptal edilmiş kayıt artık görünmez
  });

  it("3b) B de kendi paylaşımını iptal edebilir", async () => {
    expect((await call(TOKEN_B, "Bearer tok-b")).status).toBe(200);
  });

  it("4) geçersiz token biçimi → 400", async () => {
    expect((await call("../etc/passwd", "Bearer tok-a")).status).toBe(400);
    expect((await call("gecersiz", "Bearer tok-a")).status).toBe(400);
  });

  it("5) sahipsiz/bağlamsız eski snapshot yalnızca workspace sahibi tarafından iptal edilir", async () => {
    expect((await call(TOKEN_LEGACY, "Bearer tok-b")).status).toBe(404);
    expect(world.revoked.has(TOKEN_LEGACY)).toBe(false);
    expect((await call(TOKEN_LEGACY, "Bearer tok-a")).status).toBe(200);
    expect(world.revoked.has(TOKEN_LEGACY)).toBe(true);
  });

  it("5b) markası silinmiş snapshot da yalnızca workspace sahibine açıktır", async () => {
    world.brands = world.brands.filter((brand) => brand.id !== "brand-b");
    expect((await call(TOKEN_B, "Bearer tok-b")).status).toBe(404);
    expect((await call(TOKEN_B, "Bearer tok-a")).status).toBe(200);
  });

  it("workspace sahibi tanımsızsa bağlamsız kayıt kimseye açılmaz", async () => {
    world.ownerId = null;
    expect((await call(TOKEN_LEGACY, "Bearer tok-a")).status).toBe(404);
  });
});

// Token log kontrolü: gerçek log çıktısını yakalayan test src/app/api/shares/route.test.ts içindedir.
