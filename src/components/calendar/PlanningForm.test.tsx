// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import type { CalendarItemInput } from "@/lib/calendar-store";
import PlanningForm from "./PlanningForm";

afterEach(cleanup);

function submitForm(title: string) {
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
    target: { value: title },
  });
  fireEvent.click(screen.getByRole("button", { name: "Kaydet" }));
  return { onSubmit };
}

describe("PlanningForm", () => {
  it("başlıklı form gönderilebilir", async () => {
    const { onSubmit } = submitForm("Test Başlığı");
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const input = onSubmit.mock.calls[0]?.[0];
    expect(input).toBeDefined();
    expect(input.title).toBe("Test Başlığı");
    expect(input.status).toBe("planned");
  });
});
