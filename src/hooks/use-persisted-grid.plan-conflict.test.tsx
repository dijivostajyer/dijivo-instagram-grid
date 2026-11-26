// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Sahte "veritabanı": workspace_projects için (user_id, brand_id, month, year) benzersizlik kuralı
 * gerçek kısıtla aynı kodu/mesajı döndürür. `fake.failProjects` ağ/yetki hatalarını simüle eder.
 */
const fake = vi.hoisted(() => ({
  rows: {} as Record<string, Array<Record<string, unknown>>>,
  failProjects: null as null | { code?: string; message: string },
  projectUpserts: 0,
}));

vi.mock("../lib/image-store", () => ({
  isImageRef: (value: string) => value.startsWith("idb:"),
  loadImageAsObjectUrl: vi.fn(), persistObjectUrl: vi.fn(), deleteStoredImage: vi.fn(), clearStoredImages: vi.fn(async () => undefined),
}));
vi.mock("../lib/video-store", () => ({
  isVideoRef: (value: string) => value.startsWith("idb-video:"),
  loadVideoAsObjectUrl: vi.fn(), persistVideoObjectUrl: vi.fn(), deleteStoredVideo: vi.fn(), clearStoredVideos: vi.fn(async () => undefined),
}));
vi.mock("../lib/supabase-browser", () => {
  const user = { id: "user-1" };
  const db = {
    auth: { getUser: async () => ({ data: { user } }), getSession: async () => ({ data: { session: { access_token: "t" } } }) },
    from: (table: string) => ({
      select: () => ({
        eq: () => Object.assign(Promise.resolve({ data: fake.rows[table] ?? [], error: null }), {
          maybeSingle: async () => ({ data: table === "workspace_sync_state" ? { restore_epoch: null } : (fake.rows[table] ?? [])[0] ?? null, error: null }),
        }),
      }),
      upsert: (rows: Record<string, unknown> | Array<Record<string, unknown>>) => {
        const list = Array.isArray(rows) ? rows : [rows];
        const current = fake.rows[table] ?? (fake.rows[table] = []);
        let error: { code?: string; message: string } | null = null;
        if (table === "workspace_projects") {
          fake.projectUpserts += 1;
          if (fake.failProjects) error = fake.failProjects;
          else {
            for (const row of list) {
              const clash = current.find((item) => item.id !== row.id && item.user_id === row.user_id && item.brand_id === row.brand_id && item.month === row.month && item.year === row.year);
              if (clash) {
                error = { code: "23505", message: 'duplicate key value violates unique constraint "workspace_projects_user_id_brand_id_month_year_key"' };
                break;
              }
            }
          }
        }
        if (!error) {
          for (const row of list) {
            const key = (row.id ?? row.user_id) as unknown;
            const at = current.findIndex((item) => (item.id ?? item.user_id) === key);
            if (at >= 0) current[at] = { ...current[at], ...row };
            else current.push(row);
          }
        }
        return Object.assign(Promise.resolve({ error }), {
          select: async () => ({ data: list.map((row) => ({ id: row.id, project_id: row.project_id })), error: null }),
        });
      },
      delete: () => ({
        eq: () => ({
          in: async (_column: string, ids: unknown[]) => {
            fake.rows[table] = (fake.rows[table] ?? []).filter((row) => !ids.includes(row.id));
            return { error: null };
          },
        }),
      }),
    }),
    storage: { from: () => ({ createSignedUrl: async (path: string) => ({ data: { signedUrl: `https://x.supabase.co/storage/v1/object/sign/workspace-media/${path}?token=1` }, error: null }) }) },
  };
  return { getSupabaseBrowserClient: () => db };
});

import { usePersistedGrid } from "./use-persisted-grid";

const BRAND = { id: "b1", user_id: "user-1", name: "Marka", username: "marka" };
const project = (id: string, month: number, year: number) => ({
  id, user_id: "user-1", brand_id: "b1", name: `${month}/${year}`, month, year,
  created_at: "2026-10-01T00:00:00.000Z", updated_at: "2026-10-01T00:00:00.000Z",
});

async function renderReady() {
  const hook = renderHook(() => usePersistedGrid());
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  await waitFor(() => expect(hook.result.current.projects.length).toBeGreaterThan(0));
  return hook;
}

const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 60)); });
const projectKeys = (rows: Array<Record<string, unknown>>) => rows.map((row) => `${row.month}/${row.year}`).sort();

const NOV_MESSAGE = "Bu marka için Kasım 2026 aylık planı zaten mevcut. Aynı ay için ikinci bir plan oluşturamazsınız. Mevcut planı açabilir veya farklı bir ay seçebilirsiniz.";

beforeEach(() => {
  fake.rows = {
    workspace_brands: [BRAND],
    workspace_projects: [project("p-ekim", 10, 2026)],
    workspace_prefs: [{ user_id: "user-1", active_brand_id: "b1", active_project_id: "p-ekim" }],
    workspace_posts: [],
  };
  fake.failProjects = null;
  fake.projectUpserts = 0;
  localStorage.clear();
});
afterEach(cleanup);

describe("aylık plan: veritabanı benzersizlik hatasından güvenli dönüş", () => {
  it("12) yenileme sonrası plan listesi veritabanıyla tutarlıdır", async () => {
    const first = await renderReady();
    act(() => { expect(first.result.current.createProject("Kasım", 11, 2026, false)).toBeNull(); });
    await waitFor(() => expect(projectKeys(fake.rows.workspace_projects)).toEqual(["10/2026", "11/2026"]));
    first.unmount();
    const second = await renderReady();
    await waitFor(() => expect(second.result.current.projects.map((item) => `${item.month}/${item.year}`).sort()).toEqual(["10/2026", "11/2026"]));
  });

  it("8-9-11) eşzamanlı/eski veri: DB reddederse Türkçe mesaj, liste buluttan yeniden yüklenir, sahte yerel kayıt kalmaz", async () => {
    const { result } = await renderReady();
    await flush();
    // Başka cihaz/sekme Kasım 2026'yı bu sekmeden önce oluşturdu; bu sekme bunu bilmiyor (bayat).
    fake.rows.workspace_projects.push(project("p-kasim-uzak", 11, 2026));

    act(() => { expect(result.current.createProject("Yerel Kasım", 11, 2026, false)).toBeNull(); });
    await waitFor(() => expect(result.current.syncError).toBe(NOV_MESSAGE));
    await flush();

    // Veritabanında ikinci Kasım 2026 kaydı yok; kural korundu.
    expect(projectKeys(fake.rows.workspace_projects)).toEqual(["10/2026", "11/2026"]);
    // Yerel liste buluttaki gerçek listeyle aynı: sahte "Yerel Kasım" kaydı yok.
    const names = result.current.projects.map((item) => `${item.month}/${item.year}`).sort();
    expect(names).toEqual(["10/2026", "11/2026"]);
    expect(result.current.projects.some((item) => item.name === "Yerel Kasım")).toBe(false);
    expect(result.current.projects.some((item) => item.id === "p-kasim-uzak")).toBe(true);
    // Aktif plan geçerli bir plandır; hata bandı sonraki başarılı eşitlemede silinmez.
    expect(result.current.projects.some((item) => item.id === result.current.activeProjectId)).toBe(true);
    expect(result.current.syncError).toBe(NOV_MESSAGE);
  });

  it("10) ağ/yetki hatası ay çakışması olarak gösterilmez; genel hata mesajı korunur", async () => {
    const { result } = await renderReady();
    await flush();
    fake.failProjects = { code: "42501", message: "permission denied for table workspace_projects" };
    act(() => { expect(result.current.createProject("Kasım", 11, 2026, false)).toBeNull(); });
    await waitFor(() => expect(result.current.syncError).toMatch(/^Değişiklikler buluta kaydedilemedi: workspace_projects yazılamadı: permission denied/));
    expect(result.current.syncError).not.toContain("zaten mevcut");
    // Çakışma geri kazanımı tetiklenmedi: yerel plan atılmadı (başka bir hata, ay çakışması değil).
    expect(result.current.projects.some((item) => item.name === "Kasım")).toBe(true);
  });

  it("10b) başka bir benzersizlik ihlali (birincil anahtar) ay çakışması sayılmaz", async () => {
    const { result } = await renderReady();
    await flush();
    fake.failProjects = { code: "23505", message: 'duplicate key value violates unique constraint "workspace_projects_pkey"' };
    act(() => { expect(result.current.createProject("Kasım", 11, 2026, false)).toBeNull(); });
    await waitFor(() => expect(result.current.syncError).toMatch(/^Değişiklikler buluta kaydedilemedi/));
    expect(result.current.syncError).not.toContain("zaten mevcut");
  });

  it("istemci kuralı: bu sekme çakışmayı biliyorsa createProject hata döner, durum ve DB değişmez", async () => {
    const { result } = await renderReady();
    await flush();
    const before = result.current.projects.length;
    const upserts = fake.projectUpserts;
    let message: string | null = null;
    act(() => { message = result.current.createProject("Ekim ikinci", 10, 2026, false); });
    expect(message).toBe("Bu marka için Ekim 2026 aylık planı zaten mevcut. Aynı ay için ikinci bir plan oluşturamazsınız. Mevcut planı açabilir veya farklı bir ay seçebilirsiniz.");
    await flush();
    expect(result.current.projects).toHaveLength(before);
    expect(fake.projectUpserts).toBe(upserts);
    expect(result.current.syncError).toBeNull();
  });
});
