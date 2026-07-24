import { create } from "zustand";
import {
  applyThemeToDocument,
  readStoredTheme,
  toggleTheme,
  writeStoredTheme,
  type Theme,
} from "./theme";

const browserStorage =
  typeof localStorage === "undefined" ? undefined : localStorage;
const documentRoot =
  typeof document === "undefined" ? undefined : document.documentElement;
const initialTheme = readStoredTheme(browserStorage);
applyThemeToDocument(initialTheme, documentRoot);

interface ThemeState {
  theme: Theme;
  setTheme: (next: Theme) => void;
  toggle: () => void;
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: initialTheme,
  setTheme: (next) => {
    writeStoredTheme(next, browserStorage);
    applyThemeToDocument(next, documentRoot);
    set({ theme: next });
  },
  toggle: () => get().setTheme(toggleTheme(get().theme)),
}));

export function useTheme(): {
  theme: Theme;
  setTheme: (next: Theme) => void;
  toggle: () => void;
} {
  const theme = useThemeStore((state) => state.theme);
  const setTheme = useThemeStore((state) => state.setTheme);
  const toggle = useThemeStore((state) => state.toggle);
  return { theme, setTheme, toggle };
}
