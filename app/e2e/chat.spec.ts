import type { Locator } from "@playwright/test";
import { expect, test } from "./fixtures";
import { gotoSeedStoryDetail } from "./seed-navigation";

function companion(main: Locator): Locator {
  return main.locator('[data-region="companion"]');
}

test.describe("chat companion", () => {
  test("adaptive collapse, send message, and remember toggle", async ({
    page,
    seededApp,
  }) => {
    // Mutates chat on a separate story so worker-scoped seed is not polluted
    // for issue-detail key-surface snapshots on seed-story-flight.
    const main = await gotoSeedStoryDetail(
      page,
      seededApp.baseURL,
      "seed-story-merged",
      "Merged story",
    );
    const slot = companion(main);

    await expect(slot).toHaveAttribute("data-state", "collapsed");
    await expect(slot.getByRole("button", { name: "Steer this issue" })).toBeVisible();
    await expect(slot.getByText("Chat", { exact: true })).toHaveCount(0);

    await slot.getByRole("button", { name: "Steer this issue" }).click();
    await expect(slot).toHaveAttribute("data-state", "expanded");
    await expect(page).toHaveURL(/[?&]chat=expanded(?:&|$)/);
    await expect(slot.getByText("Chat", { exact: true })).toBeVisible();
    await expect(
      slot.getByText("No messages yet. Type below to steer this issue."),
    ).toBeVisible();

    const composer = slot.getByRole("textbox", { name: "Steer this issue" });
    const message = "E2E steering note from Playwright";
    await composer.fill(message);
    await slot.getByRole("button", { name: "Send" }).click();

    await expect(slot.getByText(message)).toBeVisible();
    await expect(
      slot.getByText("No messages yet. Type below to steer this issue."),
    ).toHaveCount(0);

    await slot.getByRole("button", { name: "Collapse chat" }).click();
    await expect(slot).toHaveAttribute("data-state", "collapsed");
    await expect(page).toHaveURL(/[?&]chat=collapsed(?:&|$)/);
    await expect(composer).toHaveCount(0);

    await slot.getByRole("button", { name: "Steer this issue" }).click();
    await expect(slot).toHaveAttribute("data-state", "expanded");
    await expect(page).toHaveURL(/[?&]chat=expanded(?:&|$)/);
    await expect(slot.getByText(message)).toBeVisible();

    await page.reload({ waitUntil: "load" });
    const afterReload = companion(page.getByRole("main"));
    await expect(afterReload).toHaveAttribute("data-state", "expanded");
    await expect(page).toHaveURL(/[?&]chat=expanded(?:&|$)/);
    await expect(afterReload.getByText(message)).toBeVisible();

    await afterReload.getByRole("button", { name: "Collapse chat" }).click();
    await expect(afterReload).toHaveAttribute("data-state", "collapsed");
    await expect(page).toHaveURL(/[?&]chat=collapsed(?:&|$)/);

    await page.reload({ waitUntil: "load" });
    const collapsedAfterReload = companion(page.getByRole("main"));
    await expect(collapsedAfterReload).toHaveAttribute("data-state", "collapsed");
    await expect(page).toHaveURL(/[?&]chat=collapsed(?:&|$)/);
    await expect(
      collapsedAfterReload.getByRole("button", { name: "Steer this issue" }),
    ).toBeVisible();
    await expect(collapsedAfterReload.getByRole("textbox")).toHaveCount(0);

    // Adaptive: with messages and no override, companion opens.
    await page.goto(
      `${seededApp.baseURL}/projects/seed-proj/issues/seed-story-merged`,
    );
    const adaptive = companion(page.getByRole("main"));
    await expect(adaptive).toHaveAttribute("data-state", "expanded");
    await expect(adaptive.getByText(message)).toBeVisible();
  });
});
