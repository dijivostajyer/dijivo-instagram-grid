import { describe, expect, it, vi } from "vitest";

const getUser = vi.hoisted(() => vi.fn());
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ auth: { getUser } }) }));

import { authenticateRequest } from "./server-auth";

const env = { SUPABASE_URL: "https://proj.supabase.co", SUPABASE_SECRET_KEY: "secret" } as unknown as NodeJS.ProcessEnv;
const req = (authorization?: string) => new Request("https://app.test/api/feedback", { headers: authorization ? { authorization } : {} });

describe("authenticateRequest (Geri Dönüşler API)", () => {
  it("yapılandırma yoksa 503, token yoksa 401", async () => {
    expect(await authenticateRequest(req("Bearer x"), {} as NodeJS.ProcessEnv)).toMatchObject({ ok: false, status: 503 });
    expect(await authenticateRequest(req(), env)).toMatchObject({ ok: false, status: 401 });
    expect(getUser).not.toHaveBeenCalled();
  });

  it("geçersiz/süresi dolmuş oturum 401; geçerli oturum kullanıcı kimliğini döndürür", async () => {
    getUser.mockResolvedValueOnce({ data: { user: null }, error: { message: "expired" } });
    expect(await authenticateRequest(req("Bearer eski"), env)).toMatchObject({ ok: false, status: 401 });
    getUser.mockResolvedValueOnce({ data: { user: { id: "user-1" } }, error: null });
    expect(await authenticateRequest(req("Bearer gecerli"), env)).toEqual({ ok: true, userId: "user-1" });
    expect(getUser).toHaveBeenLastCalledWith("gecerli");
  });
});
