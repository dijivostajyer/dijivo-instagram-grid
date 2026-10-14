import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  auth: { ok: false, status: 401, error: "Bu işlem için giriş yapın." } as Record<string, unknown>,
  owner: "00000000-0000-4000-8000-000000000001" as string | null,
  engine: null as unknown,
  engineCalls: 0,
}));

vi.mock("@/lib/server-auth", () => ({ authenticateRequest: vi.fn(async () => state.auth) }));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: state.owner ? { owner_id: state.owner } : null, error: null }) }) }) }),
  }),
}));
vi.mock("@/lib/backup/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/backup/server")>();
  return {
    ...actual,
    createBackupEngine: () => {
      state.engineCalls += 1;
      return state.engine;
    },
  };
});

import { BackupEngine } from "@/lib/backup/engine";
import { FileSystemBackupStore } from "@/lib/backup/files";
import { InMemoryBackupDatabase, InMemoryBackupMetaStore, InMemoryBackupStorage } from "@/lib/backup/memory";
import { GET as overviewGet, POST as backupPost } from "./route";
import { DELETE as backupDelete } from "./[id]/route";
import { GET as downloadGet } from "./[id]/download/route";
import { POST as restorePost } from "./[id]/restore/route";
import { POST as cronPost } from "./run-scheduled/route";
import { PATCH as settingsPatch } from "./settings/route";

const OWNER = "00000000-0000-4000-8000-000000000001";
const OTHER = "99999999-9999-4999-8999-999999999999";
const SECRET = "test-cron-secret-0123456789abcdef-XYZ";
const BUCKETS = ["workspace-media", "share-images", "share-media"];

let dir: string;
let meta: InMemoryBackupMetaStore;
let clock: Date;
const env = { ...process.env, SUPABASE_URL: "https://proj.supabase.co", SUPABASE_SECRET_KEY: "test-service-key" };

function tables() {
  return {
    workspace_brands: [{ user_id: OWNER, id: "b1", name: "Moda", username: "moda" }],
    workspace_projects: [], workspace_posts: [], workspace_highlights: [], workspace_stories: [], workspace_prefs: [],
    calendar_items: [], share_snapshots: [], share_feedback: [], share_feedback_workflow_events: [], instagram_import_jobs: [],
    workspace_bootstrap: [{ id: true, owner_id: OWNER }],
  };
}

const request = (url: string, init: RequestInit = {}) => new Request(`https://app.test${url}`, init);
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const asOwner = () => { state.auth = { ok: true, userId: OWNER }; };

async function createBackup() {
  asOwner();
  const response = await backupPost(request("/api/backups", { method: "POST" }));
  expect(response.status).toBe(202);
  const { job } = await response.json();
  for (let attempt = 0; attempt < 50 && (await meta.getJob(job.id))?.status === "running"; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 10));
  return (await meta.getJob(job.id))!;
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "dijivo-backup-routes-"));
  clock = new Date("2026-10-14T11:30:00.000Z");
  meta = new InMemoryBackupMetaStore();
  const storage = new InMemoryBackupStorage(BUCKETS);
  storage.put("workspace-media", `${OWNER}/a.jpg`, "jpeg", "image/jpeg");
  state.engine = new BackupEngine({
    db: new InMemoryBackupDatabase(tables(), [OWNER]), storage, meta, files: new FileSystemBackupStore(dir), buckets: BUCKETS,
    appVersion: "0.1.0", now: () => new Date(clock), heartbeatMs: 0, logger: () => undefined,
  });
  state.engineCalls = 0;
  state.owner = OWNER;
  state.auth = { ok: false, status: 401, error: "Bu işlem için giriş yapın." };
  process.env = { ...env, BACKUP_CRON_SECRET: SECRET };
});

afterEach(async () => {
  process.env = { ...env };
  await rm(dir, { recursive: true, force: true });
});

describe("yetki: yalnız çalışma alanı sahibi", () => {
  it("oturum yoksa 401, sahip değilse 403; motora hiç gidilmez", async () => {
    expect((await overviewGet(request("/api/backups"))).status).toBe(401);
    state.auth = { ok: true, userId: OTHER };
    const forbidden = await overviewGet(request("/api/backups"));
    expect(forbidden.status).toBe(403);
    expect(await forbidden.json()).toEqual({ error: "Yedekleme yalnız çalışma alanı sahibi tarafından yönetilebilir." });
    state.owner = null;
    asOwner();
    expect((await overviewGet(request("/api/backups"))).status).toBe(403);
    expect(state.engineCalls).toBe(0);
  });

  it("genel görünüm sunucu dosya yolunu sızdırmaz", async () => {
    await createBackup();
    const response = await overviewGet(request("/api/backups"));
    const text = await response.text();
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(text).not.toContain(dir);
    expect(text).not.toContain(path.basename(dir));
    expect(JSON.parse(text).jobs[0]).toMatchObject({ status: "succeeded", restorable: true });
  });

  it("8. ayar: 15 dakikanın altı 400; geçerli periyot kaydedilir", async () => {
    asOwner();
    const patch = (body: unknown) => settingsPatch(request("/api/backups/settings", { method: "PATCH", body: JSON.stringify(body) }));
    for (const minutes of [1, 2, 3, 5]) {
      const rejected = await patch({ intervalMinutes: minutes });
      expect(rejected.status).toBe(400);
      expect(await rejected.json()).toMatchObject({ error: "Geçersiz yedekleme periyodu. En kısa periyot 15 dakikadır.", code: "invalid_request" });
    }
    const saved = await patch({ intervalMinutes: 15, autoEnabled: true });
    expect(saved.status).toBe(200);
    expect((await saved.json()).settings).toMatchObject({ intervalMinutes: 15, autoEnabled: true });
    expect(meta.settings.intervalMinutes).toBe(15);
    state.auth = { ok: true, userId: OTHER };
    expect((await patch({ intervalMinutes: 30 })).status).toBe(403);
    expect(meta.settings.intervalMinutes).toBe(15);
  });

  it("H. cooldown 429 + retryAt", async () => {
    await createBackup();
    const response = await backupPost(request("/api/backups", { method: "POST" }));
    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({ code: "cooldown", retryAt: "2026-10-14T11:35:00.000Z" });
  });
});

describe("X. indirme yetkisi", () => {
  it("oturumsuz 401, başka kullanıcı 403, sahip akış olarak indirir (public URL yok)", async () => {
    const job = await createBackup();
    state.auth = { ok: false, status: 401, error: "Bu işlem için giriş yapın." };
    expect((await downloadGet(request(`/api/backups/${job.id}/download`), params(job.id))).status).toBe(401);
    state.auth = { ok: true, userId: OTHER };
    expect((await downloadGet(request(`/api/backups/${job.id}/download`), params(job.id))).status).toBe(403);

    asOwner();
    const response = await downloadGet(request(`/api/backups/${job.id}/download`), params(job.id));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/zip");
    expect(response.headers.get("content-disposition")).toBe(`attachment; filename="${job.fileName}"`);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const bytes = Buffer.from(await response.arrayBuffer());
    expect(bytes.length).toBe(job.sizeBytes);
    expect(bytes.subarray(0, 2).toString()).toBe("PK");
    expect((await downloadGet(request("/api/backups/x/download"), params("../../.env"))).status).toBe(404);
  });
});

describe("Y. silme yetkisi ve onayı", () => {
  it("başka kullanıcı 403; onaysız 400; sahip + onay → silinir", async () => {
    const job = await createBackup();
    const del = (body?: unknown) => backupDelete(request(`/api/backups/${job.id}`, { method: "DELETE", body: body === undefined ? undefined : JSON.stringify(body) }), params(job.id));
    state.auth = { ok: true, userId: OTHER };
    expect((await del({ confirm: true })).status).toBe(403);
    asOwner();
    expect((await del()).status).toBe(400);
    expect((await del({ confirm: "yes" })).status).toBe(400);
    expect((await meta.getJob(job.id))!.deletedAt).toBeNull();
    expect((await del({ confirm: true })).status).toBe(200);
    expect((await meta.getJob(job.id))!.deletedReason).toBe("user");
  });

  it("geri yükleme de açık onay ister", async () => {
    const job = await createBackup();
    const response = await restorePost(request(`/api/backups/${job.id}/restore`, { method: "POST", body: "{}" }), params(job.id));
    expect(response.status).toBe(400);
    expect([...meta.jobs.values()].some((item) => item.operation === "restore")).toBe(false);
  });
});

describe("cron uç noktası", () => {
  const cron = (authorization?: string) =>
    cronPost(request("/api/backups/run-scheduled", { method: "POST", headers: authorization ? { authorization } : {} }));

  it("AA. secret yanlış/eksik → 401; tanımsız veya kısa → 503; motora gidilmez", async () => {
    expect((await cron()).status).toBe(401);
    expect((await cron("Bearer yanlis-secret")).status).toBe(401);
    expect((await cron(`Bearer ${SECRET}x`)).status).toBe(401);
    expect((await cron(SECRET)).status).toBe(200);
    state.engineCalls = 0;
    process.env = { ...env, BACKUP_CRON_SECRET: "" };
    expect((await cron(`Bearer ${SECRET}`)).status).toBe(503);
    process.env = { ...env, BACKUP_CRON_SECRET: "kisa" };
    expect((await cron("Bearer kisa")).status).toBe(503);
    expect(state.engineCalls).toBe(0);
    // Kullanıcı oturumu cron yetkisi sayılmaz.
    asOwner();
    process.env = { ...env, BACKUP_CRON_SECRET: SECRET };
    expect((await cron("Bearer user-session-token")).status).toBe(401);
  });

  it("AB. secret doğru ama zaman gelmediyse no-op; zamanı gelince yedek alır", async () => {
    await createBackup();
    const jobsBefore = meta.jobs.size;
    clock = new Date("2026-10-14T12:00:00.000Z");
    const response = await cron(`Bearer ${SECRET}`);
    expect(response.status).toBe(200);
    expect(JSON.parse(await response.text())).toEqual({ status: "not_due", nextAt: "2026-10-15T11:30:00.000Z" });
    expect(meta.jobs.size).toBe(jobsBefore);
    expect(meta.settings.cronLastSeenAt).toBe("2026-10-14T12:00:00.000Z");

    clock = new Date("2026-10-15T11:30:00.000Z");
    const due = JSON.parse(await (await cron(`Bearer ${SECRET}`)).text());
    // Veri değişmediği için yeni dosya yazılmadı.
    expect(due).toEqual({ status: "unchanged" });
  });
});
