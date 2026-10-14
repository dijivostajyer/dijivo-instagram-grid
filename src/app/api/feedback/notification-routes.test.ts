import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ result: { ok: false, status: 401, error: "Bu işlem için giriş yapın." } as Record<string, unknown> }));
const driverCalls = vi.hoisted(() => ({ list: [] as string[] }));

vi.mock("@/lib/server-auth", () => ({ authenticateRequest: vi.fn(async () => auth.result) }));
vi.mock("@/lib/feedback-center-supabase", () => ({
  SupabaseFeedbackCenterDriver: class {
    async countUnread(userId: string) { driverCalls.list.push(`count:${userId}`); return 3; }
    async recent(userId: string) { driverCalls.list.push(`recent:${userId}`); return []; }
    async markAllRead(userId: string) { driverCalls.list.push(`all:${userId}`); return 3; }
  },
}));

import { GET as unreadGet } from "./unread/route";
import { POST as readAllPost } from "./read-all/route";

beforeEach(() => {
  driverCalls.list = [];
});

describe("bildirim uç noktaları kimlik doğrulaması", () => {
  it("R. oturum yoksa 401; veri katmanına hiç gidilmez", async () => {
    auth.result = { ok: false, status: 401, error: "Bu işlem için giriş yapın." };
    const unread = await unreadGet(new Request("https://app.test/api/feedback/unread"));
    const readAll = await readAllPost(new Request("https://app.test/api/feedback/read-all", { method: "POST" }));
    expect(unread.status).toBe(401);
    expect(readAll.status).toBe(401);
    expect(driverCalls.list).toEqual([]);
  });

  it("S. oturumdaki kullanıcı kimliğiyle kapsamlanır", async () => {
    auth.result = { ok: true, userId: "user-1" };
    const unread = await unreadGet(new Request("https://app.test/api/feedback/unread"));
    expect(await unread.json()).toEqual({ count: 3, items: [] });
    const readAll = await readAllPost(new Request("https://app.test/api/feedback/read-all", { method: "POST" }));
    expect(await readAll.json()).toEqual({ updated: 3, unreadCount: 3 });
    expect(driverCalls.list.every((call) => call.endsWith(":user-1"))).toBe(true);
  });
});
