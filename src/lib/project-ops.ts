import type { GridProject } from "./storage";

const MONTH_NAMES_TR = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];

/** Türkçe ay adı: "Ekim". Geçersiz ay değeri için sayısal etiket döner. */
export function monthName(month: number): string {
  return MONTH_NAMES_TR[month - 1] ?? String(month);
}

/** Türkçe ay etiketi: "Ekim 2026". Geçersiz ay değeri için sayısal etiket döner. */
export function monthLabel(month: number, year: number): string {
  return `${monthName(month)} ${year}`;
}

/** Veritabanındaki benzersizlik kuralının adı: (user_id, brand_id, month, year). */
export const PROJECT_MONTH_CONSTRAINT = "workspace_projects_user_id_brand_id_month_year_key";

/** Aynı marka + ay + yıl için ikinci plan açılamaz: kullanıcıya gösterilen açıklama. */
export function duplicateMonthMessage(month: number, year: number): string {
  return `Bu marka için ${monthLabel(month, year)} aylık planı zaten mevcut. Aynı ay için ikinci bir plan oluşturamazsınız. Mevcut planı açabilir veya farklı bir ay seçebilirsiniz.`;
}

/** Eski kayıtlarda `brandId` olmayabilir; veritabanı da marka kimliğini böyle çözer. */
export function projectBrandId(project: GridProject): string {
  return project.brandId ?? project.brand.id;
}

/**
 * Aynı marka, aynı ay VE aynı yıl için var olan plan. Yalnızca ay numarası değil
 * yıl da karşılaştırılır; başka markanın planı çakışma sayılmaz.
 */
export function findProjectForMonth(
  projects: readonly GridProject[],
  brandId: string,
  month: number,
  year: number,
): GridProject | null {
  return (
    projects.find(
      (project) =>
        projectBrandId(project) === brandId && project.month === month && project.year === year,
    ) ?? null
  );
}

/** Seçilen yıl içinde, bu markanın planı bulunan aylar (1-12). */
export function takenMonthsOfYear(
  projects: readonly GridProject[],
  brandId: string,
  year: number,
): Set<number> {
  const taken = new Set<number>();
  for (const project of projects) {
    if (projectBrandId(project) === brandId && project.year === year) taken.add(project.month);
  }
  return taken;
}

/** Yıl içinde (verilen aydan başlayarak) ilk boş ay; hepsi doluysa null. */
export function firstFreeMonth(taken: ReadonlySet<number>, from = 1): number | null {
  for (let step = 0; step < 12; step += 1) {
    const month = ((from - 1 + step) % 12) + 1;
    if (!taken.has(month)) return month;
  }
  return null;
}

/**
 * Supabase hatası, YALNIZCA (user_id, brand_id, month, year) benzersizlik
 * kuralını ihlal ediyorsa true döner. Ağ/yetki/diğer benzersizlik hataları
 * ay çakışması sayılmaz.
 */
export function isProjectMonthConflict(error: { code?: string; message?: string; details?: string } | null | undefined): boolean {
  if (!error) return false;
  const text = `${error.message ?? ""} ${error.details ?? ""}`;
  if (!text.includes(PROJECT_MONTH_CONSTRAINT)) return false;
  return error.code === undefined || error.code === "23505";
}

export function previousMonth(month: number, year: number): { month: number; year: number } {
  return month === 1 ? { month: 12, year: year - 1 } : { month: month - 1, year };
}

/**
 * Aynı ayın birden çok projesinde en son güncellenen proje deterministik seçilir.
 * `brandId` verildiğinde yalnızca o markaya ait projeler alınır (§19:
 * "Önceki ayı kopyala" aynı marka içinde kalır; başka marka asla
 * otomatik kaynak olarak seçilmez).
 */
export function findPreviousMonthProject(
  projects: GridProject[],
  month: number,
  year: number,
  brandId?: string,
): GridProject | null {
  const previous = previousMonth(month, year);
  return projects
    .filter(
      (project) =>
        project.month === previous.month &&
        project.year === previous.year &&
        (brandId === undefined || project.brandId === brandId),
    )
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || right.createdAt.localeCompare(left.createdAt))[0] ?? null;
}
