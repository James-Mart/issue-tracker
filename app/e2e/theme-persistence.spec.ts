import { expect, test } from "./fixtures";
import { gotoCockpitReady } from "./seed-navigation";
import { expectThemeState } from "./snapshot-both-themes";

test("theme toggle persists across reload", async ({ page, seededApp }) => {
  await gotoCockpitReady(page, seededApp.baseURL);

  await expectThemeState(page, { dataTheme: "dark", storage: null });

  await page.getByRole("button", { name: "Switch to light theme" }).click();
  await expectThemeState(page, { dataTheme: "light", storage: "light" });

  await page.reload({ waitUntil: "load" });
  await expectThemeState(page, { dataTheme: "light", storage: "light" });
});
