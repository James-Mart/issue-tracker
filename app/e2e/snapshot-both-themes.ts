import { expect, type Page } from "@playwright/test";

const THEME_STORAGE_KEY = "ui-theme";
const THEMES = ["dark", "light"] as const;

type Theme = (typeof THEMES)[number];

export async function expectThemeState(
  page: Page,
  expected: { dataTheme: Theme; storage: Theme | null },
): Promise<void> {
  await expect(page.locator("html")).toHaveAttribute("data-theme", expected.dataTheme);
  const storage = await page.evaluate(
    (key) => localStorage.getItem(key),
    THEME_STORAGE_KEY,
  );
  expect(storage).toBe(expected.storage);
}

export async function applyTheme(
  page: Page,
  theme: (typeof THEMES)[number],
): Promise<void> {
  await page.evaluate(
    ({ key, theme: next }) => {
      localStorage.setItem(key, next);
    },
    { key: THEME_STORAGE_KEY, theme },
  );
  // Reload so index.html / theme store re-read `ui-theme` and set `data-theme`.
  // Avoid `networkidle` — the app keeps the issues API warm with polling.
  await page.reload({ waitUntil: "load" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  await page.evaluate(() => document.fonts.ready);
}

/**
 * Capture `toHaveScreenshot` for dark and light via `ui-theme` / `data-theme`.
 * Optional `setup` runs after each theme apply (e.g. re-open a dialog lost on reload).
 */
export async function snapshotBothThemes(
  page: Page,
  name: string,
  setup?: () => Promise<void>,
): Promise<void> {
  for (const theme of THEMES) {
    await applyTheme(page, theme);
    if (setup) await setup();
    await expect(page).toHaveScreenshot(`${name}-${theme}.png`);
  }
}
