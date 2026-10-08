import { describe, expect, it } from "vitest";

import {
  selectCalendarBackend,
  type CalendarBackend,
  type BackendProbe,
} from "./calendar-backend";

describe("calendar backend seçimi", () => {
  it("Supabase yapılandırılmış ve erişilebilirse Supabase seçilir", () => {
    const probe: BackendProbe = { configured: true, reachable: true };
    expect(selectCalendarBackend(probe)).toBe("supabase");
  });

  it("supabase yapılandırılmamışsa local seçilir", () => {
    const probe: BackendProbe = { configured: false, reachable: false };
    expect(selectCalendarBackend(probe)).toBe("local");
  });

  it("supabase yapılandırılmış ama erişilemezse local seçilir", () => {
    const probe: BackendProbe = { configured: true, reachable: false };
    expect(selectCalendarBackend(probe)).toBe("local");
  });

  it("source of truth", () => {
    expect(selectCalendarBackend({ configured: true, reachable: true })).toBe("supabase");
  });
});
