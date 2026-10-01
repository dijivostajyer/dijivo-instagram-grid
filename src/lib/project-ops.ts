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
