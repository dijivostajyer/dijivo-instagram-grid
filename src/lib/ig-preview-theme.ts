import { useCallback, useState } from "react";

const THEME_KEY = "dijivo-ig-preview-theme";

/** Instagram önizleme teması (§15: localStorage'a kalıcıdır). */
export type IgPreviewTheme = "light" | "dark";

/** Minimal oku/yaz arayüzü (saf yardımcıları test edilebilir kılar). */
export interface ThemeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Kayıtlı temayı okur; yok/hatalıyse `light` varsayılır. */
export function readPreviewTheme(
  storage: ThemeStorage | null | undefined,
): IgPreviewTheme {
  try {
    return storage?.getItem(THEME_KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

/** Tema tercihini kalıcı yazar; depolama hatası yoksayılır. */
export function writePreviewTheme(
  storage: ThemeStorage | null | undefined,
  theme: IgPreviewTheme,
): void {
  try {
    storage?.setItem(THEME_KEY, theme);
  } catch {
    // Yerel depolama yok: tercih yalnızca bu oturumda tutulur.
  }
}

function readInitialTheme(): IgPreviewTheme {
  if (typeof window === "undefined") return "light";
  return readPreviewTheme(window.localStorage);
}

/**
 * Instagram önizlemesinin light/dark tercihini yönetir.
 * Tercih localStorage'da kalır; hem GridPreview hem PostModal
 * aynı hook'u kullandığı için iki görünüm eş zamanlı kalır.
 */
export function useInstagramPreviewTheme(): [IgPreviewTheme, () => void] {
  const [theme, setTheme] = useState<IgPreviewTheme>(readInitialTheme);

  const toggleTheme = useCallback(() => {
    setTheme((current) => {
      const next: IgPreviewTheme = current === "dark" ? "light" : "dark";
      try {
        window.localStorage.setItem(THEME_KEY, next);
      } catch {
        // Yerel depolama yok: tercih yalnızca bu oturumda tutulur.
      }
      return next;
    });
  }, []);

  return [theme, toggleTheme];
}
