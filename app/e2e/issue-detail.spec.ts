import type { Locator } from "@playwright/test";
import { expect, test } from "./fixtures";
import { gotoSeedEpicDetail, gotoSeedStoryDetail } from "./seed-navigation";
import { snapshotBothThemes } from "./snapshot-both-themes";

async function centerY(locator: Locator): Promise<number> {
  const box = await locator.boundingBox();
  if (!box) throw new Error("element has no layout box");
  return box.y + box.height / 2;
}

test.describe("issue detail", () => {
  // Sole both-theme key-surface snapshot for the single-column issue detail.
  test("both-theme single-column key-surface snapshot", async ({
    page,
    seededApp,
  }) => {
    const main = await gotoSeedStoryDetail(page, seededApp.baseURL);

    await expect(main.locator('[data-region="companion"]')).toHaveCount(0);
    await expect(main.locator('[data-region="comments"]')).toBeVisible();
    await expect(main.getByText("Description")).toBeVisible();
    await expect(main.getByText("Part of")).toBeVisible();
    await expect(main.locator('[data-region="meta-scalars"]')).toBeVisible();
    const ownFlow = main.locator('[data-region="own-flow"]');
    await expect(ownFlow).toBeAttached();
    // Story own-flow: this Story's task Rail only (no sibling/stacked Stories).
    const rail = ownFlow.getByTestId("story-task-rail");
    await expect(rail).toBeVisible();
    await expect(rail.getByRole("listitem")).toHaveCount(1);
    await expect(rail.getByText("Task in flight")).toBeVisible();
    // Work is already on a step: the traveler rests hidden, no entrance from
    // the top of the rail.
    const workCursor = rail.getByTestId("rail-work-cursor");
    await expect(workCursor).toHaveAttribute("data-traveling", "false");
    await expect(ownFlow.getByText("Merged story")).toHaveCount(0);

    await snapshotBothThemes(page, "issue-detail");
  });

  test("epic own-flow shows child-story rail with state-colored ports", async ({
    page,
    seededApp,
  }) => {
    const main = await gotoSeedEpicDetail(page, seededApp.baseURL);
    const ownFlow = main.locator('[data-region="own-flow"]');
    const rail = ownFlow.getByTestId("epic-story-rail");
    await expect(rail).toBeVisible();
    await expect(rail.getByRole("listitem")).toHaveCount(2);
    await expect(rail.getByText("Story in flight")).toBeVisible();
    await expect(rail.getByText("Merged story")).toBeVisible();
    const workCursor = rail.getByTestId("rail-work-cursor");
    await expect(workCursor).toBeAttached();
    // The traveler sits on the measured center of the in-flight port.
    const inFlightPort = rail.locator(
      '[data-testid="rail-port"][data-state="in-flight"]',
    );
    expect(
      Math.abs((await centerY(workCursor)) - (await centerY(inFlightPort))),
    ).toBeLessThanOrEqual(1);
    await expect(
      rail.getByRole("link", { name: "Story in flight" }),
    ).toHaveAttribute("href", "/projects/seed-proj/issues/seed-story-flight");
    await expect(
      rail.getByRole("link", { name: "Merged story" }),
    ).toHaveAttribute("href", "/projects/seed-proj/issues/seed-story-merged");
    await expect(ownFlow.getByTestId("dep-graph-node")).toHaveCount(0);
  });
});
