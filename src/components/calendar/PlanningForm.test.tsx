// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import type { CalendarItemInput } from "@/lib/calendar-store";
import PlanningForm from "./PlanningForm";

afterEach(cleanup);

async function submitWithReminder(value: string, custom?: [string, string, string]) {
  const onSubmit = vi.fn<(input: CalendarItemInput, id: string | null) => Promise<boolean>>(
    async () => true,
  );
  render(
    <PlanningForm
      brandId="brand-test"
      projectId="project-test"
      defaultDate={new Date("2026-10-10T12:00:00.000Z")}
      linkedOptions={[]}
      saveError={null}
      onSubmit={onSubmit}
      onClose={vi.fn()}
    />,
  );
  fireEvent.change(screen.getByPlaceholderText("Örn. Haftanın tasarruf önerisi"), {
    target: { value: "Hatırlatıcı testi" },
  });
  fireEvent.change(screen.getByLabelText("Hatırlatma"), { target: { value } });
  if (custom) {
    fireEvent.change(screen.getByLabelText("Gün"), { target: { value: custom[0] } });
    fireEvent.change(screen.getByLabelText("Saat"), { target: { value: custom[1] } });
    fireEvent.change(screen.getByLabelText("Dakika"), { target: { value: custom[2] } });
  }
  fireEvent.click(screen.getByRole("button", { name: "Kaydet" }));
  await waitFor(() => expect(onSubmit).toHaveBeenCalled());
  const input = onSubmit.mock.calls[0]?.[0];
  if (!input) throw new Error("Form submit payload üretmedi.");
  return input;
}

describe("PlanningForm hatırlatıcı payload'ı", () => {
  it.each([["15", 15], ["60", 60], ["1440", 1440], ["2880", 2880]])(
    "%s dakikalık seçimi create payload'ına taşır",
    async (value, expected) => {
      const input = await submitWithReminder(value);
      expect(input.reminderOffsetMinutes).toBe(expected);
    },
  );

  it("özel seçimi dakika toplamına dönüştürür", async () => {
    const input = await submitWithReminder("-1", ["2", "3", "4"]);
    expect(input.reminderOffsetMinutes).toBe(3064);
  });

  it("hatırlatıcı kaldırıldığında null gönderir", async () => {
    const input = await submitWithReminder("");
    expect(input.reminderOffsetMinutes).toBeNull();
  });
});
