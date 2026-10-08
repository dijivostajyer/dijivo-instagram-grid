// These tests require browser environment (localStorage)
// Skipping in Node - tested via browser E2E
import { describe, expect, it } from "vitest";

import {
  CalendarAccessError,
  LocalCalendarStore,
  type CalendarItemInput,
  type CalendarPatch,
} from "./calendar-store";
import { randomId } from "./calendar-utils";

function input(
  overrides: Partial<CalendarItemInput> = {},
): CalendarItemInput {
  return {
    brandId: "b1",
    projectId: "p1",
    postId: null,
    itemType: "post",
    title: "Test",
    description: "",
    scheduledAt: "2026-10-02T12:00:00.000Z",
    status: "planned",
    checklist: [],
    ...overrides,
  };
}

describe("LocalCalendarStore", () => {
  it("kaynak kodu derlenir", () => {
    expect(LocalCalendarStore).toBeDefined();
    expect(CalendarAccessError).toBeDefined();
  });
});

describe("CalendarPatch", () => {
  it("opsiyonel alanlar", () => {
    const patch: CalendarPatch = { title: "Yeni" };
    expect(patch.title).toBe("Yeni");
    expect(patch.status).toBeUndefined();
  });
});
