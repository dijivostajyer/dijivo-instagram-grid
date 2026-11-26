// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

import MonthlyProjects from "./MonthlyProjects";
import type { GridProject } from "@/lib/storage";

// Form varsayılanı (ay/yıl) gerçek saatten gelir; testler gerçek tarihe bağlı olmasın diye
// yalnızca Date sabitlenir (zamanlayıcılar gerçek kalır).
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-26T12:00:00Z"));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function project(id: string, month: number, year: number, brandId = "brand-a"): GridProject {
  return {
    id,
    name: `${month}/${year}`,
    month,
    year,
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-01T00:00:00.000Z",
    brandId,
    brand: { id: brandId, name: brandId, username: brandId },
    existingPosts: [],
    plannedPosts: [],
  };
}

function renderPlans(
  projects: GridProject[],
  options: { onCreate?: (...args: [string, number, number, boolean]) => string | null; loading?: boolean; brandId?: string } = {},
) {
  const onCreate = vi.fn(options.onCreate ?? (() => null));
  const utils = render(
    <MonthlyProjects
      projects={projects}
      brandId={options.brandId ?? "brand-a"}
      loading={options.loading}
      activeProjectId={projects[0]?.id ?? ""}
      shareLink={null}
      onOpen={() => undefined}
      onCreate={onCreate}
    />,
  );
  return { ...utils, onCreate };
}

function openCreator() {
  fireEvent.click(screen.getByRole("button", { name: /^Yeni ay$/ }));
}

function submit() {
  fireEvent.click(screen.getByRole("button", { name: "Oluştur" }));
}

const NOV_2026_MESSAGE =
  "Bu marka için Kasım 2026 aylık planı zaten mevcut. Aynı ay için ikinci bir plan oluşturamazsınız. Mevcut planı açabilir veya farklı bir ay seçebilirsiniz.";

describe("MonthlyProjects: ay başına tek plan kuralı", () => {
  it("1) plan yokken seçili ay oluşturulabilir ve onCreate çağrılır", () => {
    const { onCreate } = renderPlans([project("p-ekim", 10, 2026)]);
    openCreator();
    fireEvent.change(screen.getByLabelText("Yıl"), { target: { value: "2026" } });
    fireEvent.change(screen.getByLabelText("Ay"), { target: { value: "11" } });
    expect((screen.getByRole("button", { name: "Oluştur" }) as HTMLButtonElement).disabled).toBe(false);
    submit();
    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(onCreate.mock.calls[0].slice(1, 3)).toEqual([11, 2026]);
  });

  it("2) plan olan ay seçilemez: seçenek devre dışı, mevcut aylar açıkça listelenir", () => {
    renderPlans([project("p-kasim", 11, 2026), project("p-aralik", 12, 2026)]);
    openCreator();
    fireEvent.change(screen.getByLabelText("Yıl"), { target: { value: "2026" } });
    const select = screen.getByLabelText("Ay") as HTMLSelectElement;
    const optionFor = (label: string) =>
      within(select).getAllByRole("option").find((option) => option.textContent?.startsWith(label)) as HTMLOptionElement;
    expect(optionFor("Kasım").disabled).toBe(true);
    expect(optionFor("Kasım").textContent).toContain("plan var");
    expect(optionFor("Aralık").disabled).toBe(true);
    expect(optionFor("Ekim").disabled).toBe(false);
    expect(screen.getByText(/2026 için planı olan aylar: Kasım, Aralık\./)).toBeTruthy();
  });

  it("2b) ay zorla Kasım'a ayarlansa bile alanın yanında Türkçe açıklama çıkar ve gönderim kapalıdır", () => {
    const { onCreate } = renderPlans([project("p-kasim", 11, 2026)]);
    openCreator();
    // Başlangıç: form önce uygun bir ay (ör. mevcut aydan sonraki ilk boş ay) önerir; Kasım seçeneği devre dışıdır.
    const select = screen.getByLabelText("Ay") as HTMLSelectElement;
    expect(Number(select.value)).not.toBe(11);
    // Dış etkiyle (eski veri) çakışan seçim zorlanırsa:
    fireEvent.change(select, { target: { value: "11" } });
    const alert = screen.getAllByRole("alert").find((node) => node.textContent === NOV_2026_MESSAGE);
    expect(alert).toBeTruthy();
    expect(select.getAttribute("aria-invalid")).toBe("true");
    expect((screen.getByRole("button", { name: "Oluştur" }) as HTMLButtonElement).disabled).toBe(true);
    submit();
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("3) aynı markada Aralık 2026 boşsa oluşturulabilir", () => {
    const { onCreate } = renderPlans([project("p-kasim", 11, 2026)]);
    openCreator();
    fireEvent.change(screen.getByLabelText("Yıl"), { target: { value: "2026" } });
    fireEvent.change(screen.getByLabelText("Ay"), { target: { value: "12" } });
    submit();
    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(onCreate.mock.calls[0].slice(1, 3)).toEqual([12, 2026]);
  });

  it("4) farklı yıldaki aynı ay (Kasım 2027) ayrı plan olarak oluşturulabilir", () => {
    const { onCreate } = renderPlans([project("p-kasim", 11, 2026)]);
    openCreator();
    fireEvent.change(screen.getByLabelText("Yıl"), { target: { value: "2027" } });
    fireEvent.change(screen.getByLabelText("Ay"), { target: { value: "11" } });
    expect((screen.getByRole("button", { name: "Oluştur" }) as HTMLButtonElement).disabled).toBe(false);
    submit();
    expect(onCreate.mock.calls[0].slice(1, 3)).toEqual([11, 2027]);
  });

  it("5) başka markanın Kasım 2026 planı bu markanın Kasım 2026'sını engellemez", () => {
    // Liste (yanlışlıkla) başka markanın planını da içerse bile yalnızca aktif marka sayılır.
    renderPlans([project("p-b-kasim", 11, 2026, "brand-b")], { brandId: "brand-a" });
    openCreator();
    fireEvent.change(screen.getByLabelText("Yıl"), { target: { value: "2026" } });
    fireEvent.change(screen.getByLabelText("Ay"), { target: { value: "11" } });
    expect((screen.getByRole("button", { name: "Oluştur" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("6) marka değişince (brandId prop'u) kullanılabilir aylar yeniden hesaplanır", () => {
    const projects = [project("a-kasim", 11, 2026, "brand-a"), project("b-aralik", 12, 2026, "brand-b")];
    const first = renderPlans(projects, { brandId: "brand-a" });
    openCreator();
    fireEvent.change(screen.getByLabelText("Yıl"), { target: { value: "2026" } });
    expect(screen.getByText(/2026 için planı olan aylar: Kasım\./)).toBeTruthy();
    first.unmount();
    renderPlans(projects, { brandId: "brand-b" });
    openCreator();
    fireEvent.change(screen.getByLabelText("Yıl"), { target: { value: "2026" } });
    expect(screen.getByText(/2026 için planı olan aylar: Aralık\./)).toBeTruthy();
  });

  it("7) planlar yüklenirken gönderim engellenir", () => {
    const { onCreate } = renderPlans([], { loading: true });
    openCreator();
    const button = screen.getByRole("button", { name: "Oluştur" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(screen.getByRole("status").textContent).toContain("yükleniyor");
    fireEvent.submit(button.closest("form") as HTMLFormElement);
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("8) üst katman hata (ör. veritabanı çakışması) döndürürse Türkçe mesaj alanın yanında gösterilir", () => {
    renderPlans([project("p-ekim", 10, 2026)], { onCreate: () => NOV_2026_MESSAGE });
    openCreator();
    fireEvent.change(screen.getByLabelText("Yıl"), { target: { value: "2026" } });
    fireEvent.change(screen.getByLabelText("Ay"), { target: { value: "11" } });
    submit();
    expect(screen.getByRole("alert").textContent).toBe(NOV_2026_MESSAGE);
  });

  it("ay hepsi doluysa yıl için uyarı verilir", () => {
    const all = Array.from({ length: 12 }, (_, index) => project(`p-${index + 1}`, index + 1, 2026));
    renderPlans(all);
    openCreator();
    fireEvent.change(screen.getByLabelText("Yıl"), { target: { value: "2026" } });
    expect(screen.getByText(/tüm ayları için plan mevcut/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Oluştur" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("MonthlyProjects: kavram ve metin düzeltmeleri", () => {
  it("aynı ayda birden fazla plan ima eden metinler yok; ay başına tek plan kuralı açıklanır", () => {
    renderPlans([project("p-kasim", 11, 2026)]);
    expect(screen.queryByText(/bir veya daha fazla plan/)).toBeNull();
    expect(screen.queryByText(/\d+ proje/)).toBeNull();
    expect(screen.getByText(/her ayın tek bir aylık planı olur/)).toBeTruthy();
    expect(screen.getByText("1 ay planlanmış")).toBeTruthy();
  });
});
