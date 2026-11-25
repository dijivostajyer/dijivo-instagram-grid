import { readFileSync } from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const OWNER = "00000000-0000-4000-8000-000000000001";
const OTHER = "99999999-9999-4999-8999-999999999999";

/**
 * Sahte Supabase istemcisi: gerçek veritabanına bağlanmaz. Her sorgu, await edildiği anda
 * `işlem:tablo` olarak `state.log`a yazılır; `state.fail` ile eşleşen sorgu hata döner.
 */
const state = vi.hoisted(() => ({
  log: [] as string[],
  fail: null as string | null,
  bootstrapOwner: "00000000-0000-4000-8000-000000000001" as string | null,
  user: "00000000-0000-4000-8000-000000000001" as string,
}));

function result(table: string, op: string) {
  const key = `${op}:${table}`;
  state.log.push(key);
  if (state.fail === key) return { data: null, error: { code: "23503", message: "restrict ihlali (sahte)" } };
  if (op === "select" && table === "workspace_brands") return { data: [{ id: "b1" }], error: null };
  if (op === "select") return { data: [], error: null };
  return { data: null, error: null };
}

function builder(table: string) {
  let op = "select";
  const b: Record<string, unknown> = {
    select: () => b,
    delete: () => {
      op = "delete";
      return b;
    },
    eq: () => b,
    in: () => b,
    not: () => b,
    maybeSingle: async () => {
      state.log.push(`select:${table}`);
      return { data: state.bootstrapOwner ? { owner_id: state.bootstrapOwner } : null, error: null };
    },
    then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(result(table, op)).then(resolve, reject),
  };
  return b;
}

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: state.user } }, error: null }) },
    storage: {
      from: () => ({
        list: async () => ({ data: [], error: null }),
        remove: async () => ({ data: [], error: null }),
      }),
    },
    from: (table: string) => builder(table),
  }),
}));

import { POST } from "./route";

const EVENTS = "delete:share_feedback_workflow_events";
const FEEDBACK = "delete:share_feedback";
const SNAPSHOTS = "delete:share_snapshots";

function call() {
  const request = new Request("https://app.test/api/workspace/clear-all", {
    method: "POST",
    headers: { authorization: "Bearer test-token" },
  });
  return POST(request as unknown as Parameters<typeof POST>[0]);
}

beforeEach(() => {
  state.log = [];
  state.fail = null;
  state.bootstrapOwner = OWNER;
  state.user = OWNER;
  process.env.SUPABASE_URL = "https://proj.supabase.co";
  process.env.SUPABASE_SECRET_KEY = "test-service-key";
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("POST /api/workspace/clear-all: share_feedback_workflow_events RESTRICT uyumu", () => {
  it("event → feedback → snapshot sırasıyla siler (RESTRICT event varken snapshot silmeyi engeller)", async () => {
    const response = await call();
    expect(response.status).toBe(200);
    const events = state.log.indexOf(EVENTS);
    const feedback = state.log.indexOf(FEEDBACK);
    const snapshots = state.log.indexOf(SNAPSHOTS);
    expect(events).toBeGreaterThanOrEqual(0);
    expect(feedback).toBeGreaterThan(events);
    expect(snapshots).toBeGreaterThan(feedback);
  });

  it("event silmesi başarısız olursa feedback ve snapshot silinmez, 500 döner", async () => {
    state.fail = EVENTS;
    const response = await call();
    expect(response.status).toBe(500);
    expect(state.log).toContain(EVENTS);
    expect(state.log).not.toContain(FEEDBACK);
    expect(state.log).not.toContain(SNAPSHOTS);
    expect(state.log.filter((entry) => entry.startsWith("delete:workspace_"))).toEqual([]);
  });

  it("feedback silmesi başarısız olursa snapshot silinmez, 500 döner", async () => {
    state.fail = FEEDBACK;
    const response = await call();
    expect(response.status).toBe(500);
    expect(state.log).toContain(EVENTS);
    expect(state.log).toContain(FEEDBACK);
    expect(state.log).not.toContain(SNAPSHOTS);
  });

  it("bootstrap sahibi olmayan kullanıcı 403 alır ve hiçbir tablo silinmez", async () => {
    state.user = OTHER;
    const response = await call();
    expect(response.status).toBe(403);
    expect(state.log.filter((entry) => entry.startsWith("delete:"))).toEqual([]);
  });
});

describe("Migration 15: events FK'leri canlı ortamla uyumlu (RESTRICT)", () => {
  it("feedback_id ve user_id foreign key'leri on delete restrict tanımlıdır", () => {
    const sql = readFileSync(
      path.resolve(__dirname, "../../../../../supabase/migrations/20261014150000_add_feedback_workflow.sql"),
      "utf8",
    );
    const table = sql.slice(sql.indexOf("create table if not exists public.share_feedback_workflow_events"));
    const definition = table.slice(0, table.indexOf(");"));
    expect(definition).toMatch(/feedback_id uuid not null references public\.share_feedback \(id\) on delete restrict/);
    expect(definition).toMatch(/user_id uuid not null references auth\.users \(id\) on delete restrict/);
    expect(definition).not.toMatch(/on delete cascade/);
  });
});
