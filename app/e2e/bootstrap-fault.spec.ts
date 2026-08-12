import { expect, test } from "@playwright/test";

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
  await expect(
    fault.getByRole("button", { name: "Copy details" }),
  ).toBeVisible();
  await expect(page.locator("#root")).not.toBeEmpty();
});
