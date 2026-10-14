// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from "react";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import GridPreview from "./GridPreview";
import SortableGrid from "./SortableGrid";
import { computeGrid } from "@/lib/grid";
import { isInteractiveDragTarget, SafeKeyboardSensor, SafePointerSensor, SafeTouchSensor, zoneCollisionDetection } from "@/lib/dnd-sensors";
import type { ExistingPost } from "@/lib/types";

afterEach(cleanup);

const brand = { id: "brand-a", name: "Marka", username: "marka" };
const posts: ExistingPost[] = [
  { id: "P1", source: "mevcut", imageUrl: "https://cdn.test/p1.jpg", alt: "P1", recencyIndex: 10, pinned: true, pinnedOrder: 0 },
  { id: "N1", source: "mevcut", imageUrl: "https://cdn.test/n1.jpg", alt: "N1", recencyIndex: 0, pinned: false },
  { id: "N2", source: "mevcut", imageUrl: "https://cdn.test/n2.jpg", alt: "N2", recencyIndex: 1, pinned: false, postType: "reel" },
];

function card() {
  const element = document.createElement("button");
  const img = document.createElement("img");
  element.append(img);
  document.body.append(element);
  return { element, img };
}

const pointerHandler = SafePointerSensor.activators[0].handler;
const touchHandler = SafeTouchSensor.activators[0].handler;
const keyboardHandler = SafeKeyboardSensor.activators[0].handler;

function pointerDown(target: Element, currentTarget: Element, init: Partial<PointerEvent> = {}) {
  const onActivation = vi.fn();
  const nativeEvent = { isPrimary: true, button: 0, pointerType: "mouse", target, ...init };
  const result = pointerHandler({ nativeEvent, currentTarget } as unknown as ReactPointerEvent, { onActivation });
  return { result, onActivation };
}

function keyDown(target: Element, currentTarget: Element, code: string) {
  const onActivation = vi.fn();
  const preventDefault = vi.fn();
  const event = { nativeEvent: { code, target }, target, currentTarget, preventDefault } as unknown as ReactKeyboardEvent;
  const result = keyboardHandler(event, { onActivation, keyboardCodes: { start: ["Space"], cancel: ["Escape"], end: ["Space", "Enter"] } }, { active: { activatorNode: { current: currentTarget } } } as never);
  return { result, onActivation, preventDefault };
}

describe("sürükleme sensörü korumaları", () => {
  it("I. textarea üzerinde pointer drag başlamaz; kartın kendisinde başlar", () => {
    const { element, img } = card();
    const textarea = document.createElement("textarea");
    element.append(textarea);
    expect(pointerDown(textarea, element).result).toBe(false);
    expect(pointerDown(img, element).result).toBe(true);
    expect(pointerDown(element, element).result).toBe(true);
  });

  it("K. button / input / select / link / contenteditable üzerinde drag başlamaz", () => {
    const { element } = card();
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    const inner = document.createElement("span");
    editable.append(inner);
    const link = document.createElement("a");
    link.href = "https://example.test";
    for (const target of [document.createElement("button"), document.createElement("input"), document.createElement("select"), link, inner]) {
      (target === inner ? editable : target).remove();
      element.append(target === inner ? editable : target);
      expect(isInteractiveDragTarget(target, element)).toBe(true);
      expect(pointerDown(target, element).result).toBe(false);
    }
  });

  it("dokunmatik pointer olayı fare sensörünü tetiklemez; sağ tık da tetiklemez", () => {
    const { element } = card();
    expect(pointerDown(element, element, { pointerType: "touch" }).result).toBe(false);
    expect(pointerDown(element, element, { button: 2 }).result).toBe(false);
  });

  it("touch sensörü form kontrollerinde ve çoklu dokunuşta başlamaz", () => {
    const { element } = card();
    const input = document.createElement("input");
    element.append(input);
    const touch = (target: Element, touches = 1) => touchHandler({ nativeEvent: { target, touches: { length: touches } }, currentTarget: element } as never, { onActivation: vi.fn() });
    expect(touch(input)).toBe(false);
    expect(touch(element, 2)).toBe(false);
    expect(touch(element)).toBe(true);
  });

  it("J. textarea içinde Space/Enter klavye drag'ı tetiklemez ve preventDefault çağrılmaz", () => {
    const { element } = card();
    const textarea = document.createElement("textarea");
    element.append(textarea);
    for (const code of ["Space", "Enter"]) {
      const { result, onActivation, preventDefault } = keyDown(textarea, element, code);
      expect(result).toBe(false);
      expect(onActivation).not.toHaveBeenCalled();
      expect(preventDefault).not.toHaveBeenCalled();
    }
  });

  it("odak kartın kendisindeyken Space klavye drag'ı başlatır; Enter başlatmaz (tıklamaya kalır)", () => {
    const { element } = card();
    expect(keyDown(element, element, "Space").result).toBe(true);
    expect(keyDown(element, element, "Enter").result).toBe(false);
  });
});

describe("zoneCollisionDetection", () => {
  const container = (id: string, zone: string) => ({ id, data: { current: { zone } } });
  const containers = [container("P1", "pinned"), container("N1", "existing"), container("N2", "existing")];
  const args = (activeZone: string) => ({
    active: { id: "N2", data: { current: { zone: activeZone } } },
    droppableContainers: containers,
  }) as never;

  it("C/D. en yakın hedef farklı bölgedeyse hedef yoktur (en yakın aynı bölge hücresine kaymaz)", () => {
    const detect = zoneCollisionDetection(() => [{ id: "P1" }, { id: "N1" }, { id: "N2" }]);
    expect(detect(args("existing"))).toEqual([]);
  });

  it("en yakın hedef aynı bölgedeyse yalnız aynı bölge adayları döner", () => {
    const detect = zoneCollisionDetection(() => [{ id: "N1" }, { id: "P1" }, { id: "N2" }]);
    expect(detect(args("existing")).map((collision) => collision.id)).toEqual(["N1", "N2"]);
  });

  it("çarpışma yoksa boş döner", () => {
    expect(zoneCollisionDetection(() => [])(args("existing"))).toEqual([]);
  });
});

describe("GridPreview sürükle-bırak entegrasyonu", () => {
  it("sürüklenebilir kartta Space keyup varsayılanı (tıklama) iptal edilir; salt-okunurda edilmez", () => {
    const grid = computeGrid(posts, []);
    const { unmount } = render(<GridPreview brand={brand} result={grid} renderGrid={(args) => <SortableGrid {...args} onReorder={vi.fn()} />} />);
    const sortableCard = screen.getByRole("button", { name: "N1" });
    expect(fireEvent.keyUp(sortableCard, { code: "Space", key: " " })).toBe(false);
    expect(fireEvent.keyUp(sortableCard, { code: "Enter", key: "Enter" })).toBe(true);
    unmount();
    render(<GridPreview brand={brand} result={grid} onSelectPost={vi.fn()} />);
    expect(fireEvent.keyUp(screen.getByRole("button", { name: "N1" }), { code: "Space", key: " " })).toBe(true);
  });

  const grid = computeGrid(posts, []);

  it("L. tıklama PostModal seçimini açar (sürükleme aktifken de)", () => {
    const onSelect = vi.fn();
    render(<GridPreview brand={brand} result={grid} onSelectPost={onSelect} renderGrid={(args) => <SortableGrid {...args} onReorder={vi.fn()} />} />);
    const target = screen.getByRole("button", { name: "N1" });
    fireEvent.pointerDown(target, { isPrimary: true, button: 0, pointerType: "mouse", clientX: 10, clientY: 10 });
    fireEvent.pointerUp(target, { isPrimary: true, button: 0, pointerType: "mouse", clientX: 10, clientY: 10 });
    fireEvent.click(target);
    expect(onSelect).toHaveBeenCalledWith("N1");
  });

  it("J. grid dışındaki textarea'da Space/Enter/Backspace/Türkçe yazım sürüklemeyi tetiklemez, odak kalır", () => {
    const onReorder = vi.fn();
    render(
      <>
        <GridPreview brand={brand} result={grid} renderGrid={(args) => <SortableGrid {...args} onReorder={onReorder} />} />
        <textarea aria-label="Caption" defaultValue="" />
      </>,
    );
    const textarea = screen.getByLabelText("Caption") as HTMLTextAreaElement;
    textarea.focus();
    for (const code of ["Space", "Enter", "Backspace", "ArrowLeft", "KeyŞ"]) fireEvent.keyDown(textarea, { code, key: code });
    expect(document.activeElement).toBe(textarea);
    expect(screen.queryByText(/taşınıyor/)).toBeNull();
    expect(onReorder).not.toHaveBeenCalled();
  });

  it("kartta Space klavye taşımasını başlatır, Escape iptal eder; sıra değişmez", async () => {
    const onReorder = vi.fn();
    const onSelect = vi.fn();
    render(<GridPreview brand={brand} result={grid} renderGrid={(args) => <SortableGrid {...args} onReorder={onReorder} />} onSelectPost={onSelect} />);
    const target = screen.getByRole("button", { name: "N1" });
    target.focus();
    fireEvent.keyDown(target, { code: "Space", key: " " });
    expect(await screen.findByText("N1 taşınıyor.")).toBeTruthy();
    // Farklı bölgedeki sabitlenmiş kart bırakılamaz olarak işaretlenir.
    expect(screen.getByRole("button", { name: "P1" }).className).toContain("cursor-not-allowed");
    expect(screen.getByRole("button", { name: "N2" }).className).not.toContain("cursor-not-allowed");
    fireEvent.keyDown(target, { code: "Escape", key: "Escape" });
    expect(await screen.findByText(/iptal edildi/)).toBeTruthy();
    expect(onReorder).not.toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("renderGrid verilmeyen salt-okunur grid (Share) sürüklenebilir değildir", () => {
    render(<GridPreview brand={brand} result={grid} onSelectPost={vi.fn()} />);
    expect(screen.getByRole("button", { name: "N1" }).getAttribute("aria-roledescription")).toBeNull();
  });

  it("Reel kartı sürüklenebilir gridde de 2:3, Post 3:4 kalır", () => {
    render(<GridPreview brand={brand} result={grid} renderGrid={(args) => <SortableGrid {...args} onReorder={vi.fn()} />} />);
    expect(screen.getByRole("button", { name: "N2" }).className).toContain("aspect-[2/3]");
    expect(screen.getByRole("button", { name: "N1" }).className).toContain("aspect-[3/4]");
    expect(screen.getByRole("button", { name: "N1" }).getAttribute("aria-roledescription")).toBe("sortable");
  });
});
