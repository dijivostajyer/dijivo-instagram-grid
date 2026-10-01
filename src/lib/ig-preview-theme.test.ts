import { describe, expect, it } from "vitest";

import {
  readPreviewTheme,
  writePreviewTheme,
  type ThemeStorage,
} from "./ig-preview-theme";

const THEME_KEY = "dijivo-ig-preview-theme";

function fakeStorage(initial: Record<string, string> = {}) {
  const data: Record<string, string> = { ...initial };
  const storage: ThemeStorage = {
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => {
      data[key] = value;
    },
  };
  return { storage, data };
}

describe("Instagram önizleme teması (§15)", () => {
  it("okuma: kayıtlı 'dark' → dark", () => {
    const { storage } = fakeStorage({ [THEME_KEY]: "dark" });
    expect(readPreviewTheme(storage)).toBe("dark");
  });

  it("okuma: kayıt yoksa veya geçerli değilse light", () => {
    const { storage } = fakeStorage();
    expect(readPreviewTheme(storage)).toBe("light");
    const invalid = fakeStorage({ [THEME_KEY]: "blue" });
    expect(readPreviewTheme(invalid.storage)).toBe("light");
    expect(readPreviewTheme(null)).toBe("light");
    expect(readPreviewTheme(undefined)).toBe("light");
  });

  it("yazma: tercih kalıcı olarak depolanır", () => {
    const { storage, data } = fakeStorage();
    writePreviewTheme(storage, "dark");
    expect(data[THEME_KEY]).toBe("dark");
    expect(readPreviewTheme(storage)).toBe("dark");
    writePreviewTheme(storage, "light");
    expect(data[THEME_KEY]).toBe("light");
    expect(readPreviewTheme(storage)).toBe("light");
  });
});
