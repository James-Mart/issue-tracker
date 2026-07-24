import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_THEME,
  THEME_STORAGE_KEY,
  parseTheme,
  readStoredTheme,
  toggleTheme,
} from "./theme";

function createStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
    clear: () => {
      values.clear();
    },
    values,
  };
}

function createRoot() {
  const attributes = new Map<string, string>();
  return {
    setAttribute: (key: string, value: string) => {
      attributes.set(key, value);
    },
    getAttribute: (key: string) => attributes.get(key) ?? null,
    attributes,
  };
}

describe("theme slice", () => {
  let storage: ReturnType<typeof createStorage>;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    storage = createStorage();
    root = createRoot();
    vi.stubGlobal("localStorage", storage);
    vi.stubGlobal("document", { documentElement: root });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  async function loadThemeStore() {
    const { useThemeStore } = await import("./use-theme");
    return useThemeStore;
  }

  it("defaults to dark", async () => {
    expect(readStoredTheme(storage)).toBe("dark");
    expect(parseTheme(null)).toBe("dark");

    const useThemeStore = await loadThemeStore();
    expect(useThemeStore.getState().theme).toBe("dark");
  });

  it("toggle flips and persists", async () => {
    expect(toggleTheme("dark")).toBe("light");

    const useThemeStore = await loadThemeStore();
    useThemeStore.getState().toggle();

    expect(useThemeStore.getState().theme).toBe("light");
    expect(storage.values.get(THEME_STORAGE_KEY)).toBe("light");
    expect(root.getAttribute("data-theme")).toBe("light");

    useThemeStore.getState().toggle();

    expect(useThemeStore.getState().theme).toBe("dark");
    expect(storage.values.get(THEME_STORAGE_KEY)).toBe("dark");
    expect(root.getAttribute("data-theme")).toBe("dark");
  });

  it("honors a stored value on init", async () => {
    storage.setItem(THEME_STORAGE_KEY, "light");

    const useThemeStore = await loadThemeStore();

    expect(useThemeStore.getState().theme).toBe("light");
    expect(root.getAttribute("data-theme")).toBe("light");
  });

  it("setTheme writes storage and updates the document root", async () => {
    const useThemeStore = await loadThemeStore();
    useThemeStore.getState().setTheme("light");

    expect(useThemeStore.getState().theme).toBe("light");
    expect(storage.values.get(THEME_STORAGE_KEY)).toBe("light");
    expect(root.getAttribute("data-theme")).toBe("light");
  });
});
