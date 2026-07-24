export type Theme = "dark" | "light";

export const THEME_STORAGE_KEY = "ui-theme";
export const DEFAULT_THEME: Theme = "dark";

export function parseTheme(value: string | null | undefined): Theme {
  return value === "light" ? "light" : "dark";
}

export function readStoredTheme(storage?: Pick<Storage, "getItem">): Theme {
  if (!storage) return DEFAULT_THEME;
  return parseTheme(storage.getItem(THEME_STORAGE_KEY));
}

export function writeStoredTheme(
  theme: Theme,
  storage?: Pick<Storage, "setItem">,
): void {
  storage?.setItem(THEME_STORAGE_KEY, theme);
}

export function applyThemeToDocument(
  theme: Theme,
  root?: Pick<HTMLElement, "setAttribute">,
): void {
  root?.setAttribute("data-theme", theme);
}

export function toggleTheme(theme: Theme): Theme {
  return theme === "dark" ? "light" : "dark";
}
