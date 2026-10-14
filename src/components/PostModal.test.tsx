// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";

import PostModal from "./PostModal";
import type { ExistingPost } from "@/lib/types";

// Passive effect'ler (açılış odağı) her olaydan sonra senkron flush edilsin.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(cleanup);

const brand = { id: "brand-a", name: "Marka", username: "marka" };

/**
 * GridManager ile aynı desen: caption üst state'te tutulur ve onClose her
 * render'da yeni bir inline fonksiyondur. Eski hata tam olarak bu
 * kombinasyonda her tuş vuruşunda odağı kapat butonuna taşıyordu.
 */
function Harness({ onCloseSpy }: { onCloseSpy: () => void }) {
  const [post, setPost] = useState<ExistingPost>({
    id: "post-1",
    source: "mevcut",
    imageUrl: "https://cdn.example.test/post.jpg",
    recencyIndex: 0,
    pinned: false,
    caption: "",
  });
  return (
    <PostModal
      post={post}
      source="mevcut"
      brand={brand}
      allProjects={[]}
      brands={[brand]}
      onPostTypeChange={() => undefined}
      onCaptionChange={(caption) => setPost((current) => ({ ...current, caption }))}
      onChangeImage={async () => undefined}
      onCopy={() => null}
      onClose={() => onCloseSpy()}
    />
  );
}

function getCaption(): HTMLTextAreaElement {
  return document.getElementById("modal-caption") as HTMLTextAreaElement;
}

/** İmleç konumuna tek karakter (veya Backspace) uygular, tarayıcı gibi. */
function press(textarea: HTMLTextAreaElement, key: string) {
  fireEvent.keyDown(textarea, { key });
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const value = textarea.value;
  let next: string;
  let caret: number;
  if (key === "Backspace") {
    const from = start === end ? Math.max(0, start - 1) : start;
    next = value.slice(0, from) + value.slice(end);
    caret = from;
  } else {
    const text = key === "Enter" ? "\n" : key === "Space" ? " " : key;
    next = value.slice(0, start) + text + value.slice(end);
    caret = start + text.length;
  }
  // Tarayıcı gibi: değer native setter ile yazılır (React'ın value
  // tracker'ı değişikliği görür), imleç konumlanır, sonra input olayı
  // React onChange'i ve üst state güncellemesini tetikler.
  nativeValueSetter.call(textarea, next);
  textarea.setSelectionRange(caret, caret);
  fireEvent.input(textarea);
  fireEvent.keyUp(textarea, { key });
}

const nativeValueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;

function typeText(textarea: HTMLTextAreaElement, text: string) {
  for (const char of text) {
    press(textarea, char === " " ? "Space" : char);
    expect(document.activeElement).toBe(textarea);
  }
}

describe("PostModal caption odağı", () => {
  it("açılışta odak bir kez kapat butonuna verilir", () => {
    render(<Harness onCloseSpy={vi.fn()} />);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: /kapat/i }));
  });

  it("caption kesintisiz yazılır ve odak textarea'da kalır", () => {
    render(<Harness onCloseSpy={vi.fn()} />);
    const textarea = getCaption();
    textarea.focus();
    typeText(textarea, "Merhaba nasılsınız bugün?");
    expect(getCaption()).toBe(textarea);
    expect(textarea.value).toBe("Merhaba nasılsınız bugün?");
    expect(document.activeElement).toBe(textarea);
  });

  it("Türkçe karakterler, Space, Enter ve Backspace çalışır", () => {
    render(<Harness onCloseSpy={vi.fn()} />);
    const textarea = getCaption();
    textarea.focus();
    typeText(textarea, "çğıöşü ÇĞİÖŞÜ");
    press(textarea, "Enter");
    typeText(textarea, "ikinci satırx");
    press(textarea, "Backspace");
    expect(document.activeElement).toBe(textarea);
    expect(textarea.value).toBe("çğıöşü ÇĞİÖŞÜ\nikinci satır");
  });

  it("metnin ortasına yazarken imleç zıplamaz ve seçim korunur", () => {
    render(<Harness onCloseSpy={vi.fn()} />);
    const textarea = getCaption();
    textarea.focus();
    typeText(textarea, "Merhaba bugün");
    // "Merhaba " sonrasına imleç koy ve ortaya yaz.
    textarea.setSelectionRange(8, 8);
    typeText(textarea, "nasılsınız ");
    expect(textarea.value).toBe("Merhaba nasılsınız bugün");
    expect(textarea.selectionStart).toBe(19);
    expect(textarea.selectionEnd).toBe(19);

    // Seçili aralık yazılan karakterle değiştirilir; seçim sonrası korunur.
    textarea.setSelectionRange(0, 7);
    press(textarea, "S");
    expect(textarea.value).toBe("S nasılsınız bugün");
    expect(textarea.selectionStart).toBe(1);
    expect(document.activeElement).toBe(textarea);
  });

  it("ESC en güncel onClose callback'ini çağırır", () => {
    const onClose = vi.fn();
    render(<Harness onCloseSpy={onClose} />);
    const textarea = getCaption();
    textarea.focus();
    typeText(textarea, "abc");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
