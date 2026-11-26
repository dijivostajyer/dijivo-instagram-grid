import { beforeEach, describe, expect, it, vi } from "vitest";

const STAGING_REF = "yprmrkvikhijxznwvjni";
const STAGING_URL = `https://${STAGING_REF}.supabase.co`;

/** Sahte istemci: ag yok. `state.calls` hedefe ulasan her cagriyi kaydeder. */
const state = vi.hoisted(() => ({
  calls: [] as string[],
  users: 0,
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
            return { data: { user: { id: "new-user" } }, error: null };
          },
        },
      },
      from: (table: string) => ({
        insert: async () => {
          state.calls.push(`insert:${table}`);
          return { error: null };
        },
        update: () => ({
          eq: async () => {
            state.calls.push(`update:${table}`);
            return { error: null };
          },
        }),
        delete: () => ({
          eq: async () => {
            state.calls.push(`delete:${table}`);
            return { error: null };
          },
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
