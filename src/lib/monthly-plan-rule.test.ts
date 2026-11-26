import { describe, expect, it } from "vitest";

import {
  createBrandState,
  createProjectState,
  getDefaultAppState,
  resolveProjectMonthConflicts,
  selectBrandState,
  type NewBrandInput,
} from "./brand-ops";
import {
  PROJECT_MONTH_CONSTRAINT,
  duplicateMonthMessage,
  findProjectForMonth,
  firstFreeMonth,
  isProjectMonthConflict,
  takenMonthsOfYear,
} from "./project-ops";
import type { PersistedAppState } from "./storage";

/** Kural: aynı marka + ay + yıl için tek aylık plan (user_id, brand_id, month, year). */

const NOV_2026 = new Date("2026-11-05T10:00:00.000Z");

function brandInput(name: string, username: string): NewBrandInput {
  return { name, username } as NewBrandInput;
}

function withBrand(name = "Marka A", username = "markaa", at = NOV_2026) {
  const created = createBrandState(getDefaultAppState(), brandInput(name, username), at);
  if (!created) throw new Error("marka oluşturulamadı");
  return created;
}

function create(state: PersistedAppState, month: number, year: number) {
  return createProjectState(state, `${month}/${year}`, month, year, false);
}

function ok(result: ReturnType<typeof create>): { state: PersistedAppState; projectId: string } {
  if ("error" in result) throw new Error(`beklenmeyen hata: ${result.error}`);
  return result;
}

describe("aynı marka için ay başına tek aylık plan", () => {
  it("1) Kasım 2026'da plan yokken (marka başka ayda) oluşturma mümkün", () => {
    const base = withBrand("Marka A", "markaa", new Date("2026-10-05T10:00:00.000Z"));
    const result = create(base.state, 11, 2026);
    expect("error" in result).toBe(false);
  });

  it("2) Aynı marka + Kasım 2026 zaten varsa oluşturma engellenir ve Türkçe açıklama döner", () => {
    const base = withBrand();
    const result = create(base.state, 11, 2026);
    expect(result).toEqual({ error: duplicateMonthMessage(11, 2026) });
    expect((result as { error: string }).error).toBe(
      "Bu marka için Kasım 2026 aylık planı zaten mevcut. Aynı ay için ikinci bir plan oluşturamazsınız. Mevcut planı açabilir veya farklı bir ay seçebilirsiniz.",
    );
  });

  it("2b) Engellenen girişimde durum değişmez (yerel sahte kayıt yok)", () => {
    const base = withBrand();
    const before = base.state.projects!.length;
    const result = create(base.state, 11, 2026);
    expect("error" in result).toBe(true);
    expect(base.state.projects).toHaveLength(before);
  });

  it("2c) Önceki ayı kopyala seçeneği de aynı kuralı atlayamaz", () => {
    const base = withBrand();
    const result = createProjectState(base.state, "kopya", 11, 2026, true);
    expect(result).toEqual({ error: duplicateMonthMessage(11, 2026) });
  });

  it("3) Aynı marka + Aralık 2026 planı yokken oluşturma mümkün", () => {
    const base = withBrand();
    const created = ok(create(base.state, 12, 2026));
    expect(findProjectForMonth(created.state.projects!, base.brand.id, 12, 2026)).not.toBeNull();
  });

  it("4) Aynı marka + Kasım 2027 (farklı yıl) planı yokken oluşturma mümkün; yıl mutlaka dikkate alınır", () => {
    const base = withBrand();
    const created = ok(create(base.state, 11, 2027));
    const projects = created.state.projects!;
    expect(findProjectForMonth(projects, base.brand.id, 11, 2026)).not.toBeNull();
    expect(findProjectForMonth(projects, base.brand.id, 11, 2027)).not.toBeNull();
    expect(findProjectForMonth(projects, base.brand.id, 11, 2028)).toBeNull();
  });

  it("5) Başka marka + Kasım 2026 oluşturulabilir (farklı markalar engellenmez)", () => {
    const a = withBrand("Marka A", "markaa");
    const b = createBrandState(a.state, brandInput("Marka B", "markab"), NOV_2026);
    expect(b).not.toBeNull();
    // Marka B oluşturulurken kendi Kasım 2026 planı açılır; A'nınki ayrı kalır.
    const novembers = b!.state.projects!.filter((project) => project.month === 11 && project.year === 2026);
    expect(novembers).toHaveLength(2);
    expect(new Set(novembers.map((project) => project.brandId)).size).toBe(2);
    // B için ikinci Kasım 2026 hâlâ engellenir.
    expect("error" in create(b!.state, 11, 2026)).toBe(true);
  });

  it("6) Marka değişince kullanılabilir aylar markaya göre yeniden hesaplanır", () => {
    const a = withBrand("Marka A", "markaa");
    const withDec = ok(create(a.state, 12, 2026)).state; // A: Kasım + Aralık
    const b = createBrandState(withDec, brandInput("Marka B", "markab"), NOV_2026)!; // B: Kasım
    const projects = b.state.projects!;
    expect([...takenMonthsOfYear(projects, a.brand.id, 2026)].sort((x, y) => x - y)).toEqual([11, 12]);
    expect([...takenMonthsOfYear(projects, b.brand.id, 2026)]).toEqual([11]);
    // Marka B aktifken Aralık 2026 oluşturulabilir; Marka A aktifken oluşturulamaz.
    expect("error" in create(selectBrandState(b.state, b.brand.id)!, 12, 2026)).toBe(false);
    expect("error" in create(selectBrandState(b.state, a.brand.id)!, 12, 2026)).toBe(true);
  });

  it("firstFreeMonth yalnızca oluşturulabilir ayı önerir", () => {
    expect(firstFreeMonth(new Set([11, 12]), 11)).toBe(1);
    expect(firstFreeMonth(new Set([3]), 3)).toBe(4);
    expect(firstFreeMonth(new Set<number>(), 7)).toBe(7);
    expect(firstFreeMonth(new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]))).toBeNull();
  });

  it("geçersiz marka/ay/yıl güvenli biçimde reddedilir", () => {
    const base = withBrand();
    expect("error" in create(base.state, 13, 2026)).toBe(true);
    expect("error" in create(base.state, 0, 2026)).toBe(true);
    expect("error" in create(base.state, 5, 1999)).toBe(true);
    expect("error" in create(getDefaultAppState(), 5, 2026)).toBe(true);
  });
});

describe("veritabanı benzersizlik hatasının sınıflandırılması", () => {
  it("8) yalnızca (user_id, brand_id, month, year) kuralı ihlali ay çakışması sayılır", () => {
    expect(
      isProjectMonthConflict({
        code: "23505",
        message: `duplicate key value violates unique constraint "${PROJECT_MONTH_CONSTRAINT}"`,
      }),
    ).toBe(true);
  });

  it("10) ağ, yetki ve diğer benzersizlik hataları ay çakışması sayılmaz", () => {
    expect(isProjectMonthConflict(null)).toBe(false);
    expect(isProjectMonthConflict({ message: "TypeError: Failed to fetch" })).toBe(false);
    expect(isProjectMonthConflict({ code: "42501", message: "permission denied for table workspace_projects" })).toBe(false);
    expect(isProjectMonthConflict({ code: "PGRST301", message: "JWT expired" })).toBe(false);
    // Başka bir benzersizlik kuralı (örn. birincil anahtar) ay çakışması değildir.
    expect(isProjectMonthConflict({ code: "23505", message: 'duplicate key value violates unique constraint "workspace_projects_pkey"' })).toBe(false);
    // Kural adı geçse bile kod benzersizlik ihlali değilse sınıflandırılmaz.
    expect(isProjectMonthConflict({ code: "42501", message: PROJECT_MONTH_CONSTRAINT })).toBe(false);
  });
});

describe("çakışma sonrası yerel durumun buluttaki gerçek listeyle uzlaştırılması", () => {
  it("9) yereldeki kaydedilememiş çakışan plan atılır, uzaktaki mevcut plan alınır; diğerleri korunur", () => {
    // Uzak: Marka A / Kasım 2026 (id remote-nov) mevcut.
    const remoteBase = withBrand("Marka A", "markaa");
    const remoteProject = { ...remoteBase.state.projects![0], id: "remote-nov" };
    const remote: PersistedAppState = { ...remoteBase.state, projects: [remoteProject], activeProjectId: "remote-nov" };

    // Yerel (bayat): Kasım 2026 plan yok → ikinci kez oluşturulmuş sahte plan + Aralık planı.
    const staleBase = createBrandState(getDefaultAppState(), brandInput("Marka A", "markaa"), new Date("2026-10-05T10:00:00.000Z"))!;
    const brandId = staleBase.brand.id;
    const withNov = ok(createProjectState({ ...staleBase.state }, "yerel kasım", 11, 2026, false));
    const withDec = ok(create(withNov.state, 12, 2026));
    // Aktif olan, atılacak yerel Kasım planı olsun.
    const local = { ...withDec.state, activeProjectId: withNov.projectId };
    const remoteForBrand = {
      ...remote,
      projects: [{ ...remoteProject, brandId, brand: { ...remoteProject.brand, id: brandId } }],
    };

    const { state, dropped } = resolveProjectMonthConflicts(local, remoteForBrand);
    expect(dropped.map((project) => project.id)).toEqual([withNov.projectId]);
    const ids = state.projects!.map((project) => project.id);
    expect(ids).not.toContain(withNov.projectId); // sahte yerel kayıt kalmaz
    expect(ids).toContain("remote-nov"); // uzaktaki gerçek plan gelir
    expect(ids).toContain(withDec.projectId); // çakışmayan plan korunur
    expect(state.activeProjectId).toBe("remote-nov"); // aktif seçim geçerli bir plana taşınır
    // Aynı marka + ay + yıl için artık tek plan var.
    const novembers = state.projects!.filter((project) => project.month === 11 && project.year === 2026);
    expect(novembers).toHaveLength(1);
  });

  it("çakışma yoksa durum olduğu gibi kalır", () => {
    const base = withBrand();
    const { state, dropped } = resolveProjectMonthConflicts(base.state, base.state);
    expect(dropped).toEqual([]);
    expect(state).toBe(base.state);
  });
});
