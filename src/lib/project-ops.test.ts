import { describe, expect, it } from "vitest";

import { findPreviousMonthProject, previousMonth } from "./project-ops";
import type { GridProject } from "./storage";

function project(id: string, month: number, year: number, updatedAt = "2026-09-01T00:00:00.000Z"): GridProject {
  return { id, name: id, month, year, createdAt: updatedAt, updatedAt, brand: { id: `brand-${id}`, name: id, username: id }, existingPosts: [], plannedPosts: [] };
}

describe("previous-month projects", () => {
  it("Ekim için Eylül projesini bulur", () => expect(findPreviousMonthProject([project("sep", 9, 2026)], 10, 2026)?.id).toBe("sep"));
  it("Ocakta bir önceki yılın Aralığını bulur", () => expect(previousMonth(1, 2027)).toEqual({ month: 12, year: 2026 }));
  it("önceki ay yoksa null döner", () => expect(findPreviousMonthProject([], 10, 2026)).toBeNull());
  it("aynı önceki ay adaylarından en son güncelleneni seçer", () => expect(findPreviousMonthProject([project("old", 9, 2026, "2026-09-01T00:00:00.000Z"), project("new", 9, 2026, "2026-09-30T00:00:00.000Z")], 10, 2026)?.id).toBe("new"));
});
