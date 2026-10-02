// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { act } from "react";

import MonthlyProjects from "./MonthlyProjects";
import type { GridProject } from "@/lib/storage";

afterEach(() => cleanup());

function project(id: string, month: number, year: number): GridProject {
  return {
    id,
    name: `${month}/${year}`,
    month,
    year,
    createdAt: `2026-${String(month).padStart(2, "0")}-01T00:00:00.000Z`,
    updatedAt: `2026-${String(month).padStart(2, "0")}-01T00:00:00.000Z`,
    brandId: "brand-a",
    brand: { id: "brand-a", name: "Marka A", username: "markaa" },
    existingPosts: [],
    plannedPosts: [],
  };
}

const BASE_PROPS = {
  activeProjectId: "p-eylul",
  shareLink: null,
  onCreate: () => null as string | null,
};

function renderPlans(projects: GridProject[], onOpen: ReturnType<typeof vi.fn>) {
  return render(
    <MonthlyProjects
      projects={projects}
      activeProjectId={BASE_PROPS.activeProjectId}
      shareLink={BASE_PROPS.shareLink}
      onOpen={onOpen}
      onCreate={BASE_PROPS.onCreate}
    />,
  );
}

describe("MonthlyProjects — Planı Aç", () => {
  it("her plan kartında Planı Aç butonu bulunur", () => {
    renderPlans([project("p-eylul", 9, 2026), project("p-ekim", 10, 2026)], vi.fn());
    expect(screen.getAllByRole("button", { name: /^Planı Aç:/ })).toHaveLength(2);
  });

  it("Planı Aç doğru project kimliğini parent'a iletir (planner navigasyonu)", () => {
    const onOpen = vi.fn();
    renderPlans([project("p-eylul", 9, 2026), project("p-ekim", 10, 2026)], onOpen);
    // Aylar azalan sırada render edilir (Ekim → Eylül).
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Planı Aç: 9/2026" }));
    });
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledWith("p-eylul");
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Planı Aç: 10/2026" }));
    });
    expect(onOpen).toHaveBeenCalledWith("p-ekim");
  });

  it("Planı Aç aktif olmayan planı da açabilir (aktif karttan bağımsız)", () => {
    const onOpen = vi.fn();
    renderPlans([project("p-eylul", 9, 2026), project("p-ekim", 10, 2026)], onOpen);
    // Aktif plan eylül; ekim kartı tıklanır.
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Planı Aç: 10/2026" }));
    });
    expect(onOpen).toHaveBeenCalledWith("p-ekim");
  });
});
