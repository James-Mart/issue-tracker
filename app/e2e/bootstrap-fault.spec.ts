import { devices, expect, test } from "@playwright/test";

// Phone-shaped Chromium: the Fault surface is what a hand sees when the
// module graph fails. Desktop Chromium still covers the same DOM in unit
// and production-entry tests.
test.use({
  ...devices["Pixel 5"],
  viewport: { width: 390, height: 844 },
});

const MIN_TAP_TARGET = 44;

function isMainAppScript(url: string): boolean {
  const path = new URL(url).pathname;
  if (path.includes("bootstrap-fault")) return false;
  if (path.includes("/src/main.tsx")) return true;
  return path.startsWith("/assets/") && path.endsWith(".js");
}

test("a failed client module load shows Fault instead of a blank root", async ({
  page,
}) => {
  await page.route("**/*", (route) => {
    if (isMainAppScript(route.request().url())) return route.abort();
    return route.continue();
  });
  await page.goto("/");
  const fault = page.locator("[data-bootstrap-fault]");
  await expect(fault).toBeVisible();
  await expect(fault.getByRole("alert")).toContainText("Fault");
  await expect(fault.getByRole("alert")).toContainText(
    "The app failed to start.",
  );
  const copy = fault.getByRole("button", { name: "Copy details" });
  await expect(copy).toBeVisible();
  const box = await copy.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThanOrEqual(MIN_TAP_TARGET);
  expect(box!.height).toBeGreaterThanOrEqual(MIN_TAP_TARGET);
  await expect(page.locator("#root")).not.toBeEmpty();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    ),
  ).toBe(false);
});
