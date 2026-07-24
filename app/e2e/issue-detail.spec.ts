import { expect, test } from "./fixtures";
import { gotoSeedEpicDetail, gotoSeedStoryDetail } from "./seed-navigation";
import { snapshotBothThemes } from "./snapshot-both-themes";

test.describe("issue detail", () => {
  // Sole both-theme key-surface snapshot for the two-region issue detail.
  test("both-theme two-region key-surface snapshot", async ({
    page,
    seededApp,
  }) => {
    const main = await gotoSeedStoryDetail(page, seededApp.baseURL);

    await expect(main.locator('[data-region="companion"]')).toHaveAttribute(
      "data-state",
      "expanded",
    );
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
    await expect(rail.getByTestId("rail-work-cursor")).toBeAttached();
    await expect(ownFlow.getByText("Merged story")).toHaveCount(0);

    await snapshotBothThemes(page, "issue-detail");
  });

  test("epic own-flow shows neighborhood DAG and blockedBy edits round-trip", async ({
    page,
    seededApp,
  }) => {
    const main = await gotoSeedEpicDetail(page, seededApp.baseURL);
    const ownFlow = main.locator('[data-region="own-flow"]');
    const neighborhood = ownFlow.getByTestId("epic-dep-neighborhood");
    await expect(neighborhood).toBeVisible();

    // Neighborhood of B: A, B, D — not C (indirect via D).
    await expect(
      neighborhood.locator('[data-testid="dep-graph-node"]'),
    ).toHaveCount(3);
    await expect(
      neighborhood.locator(
        '[data-testid="dep-graph-node"][data-id="seed-epic-a"]',
      ),
    ).toBeVisible();
    await expect(
      neighborhood.locator(
        '[data-testid="dep-graph-node"][data-id="seed-epic-b"]',
      ),
    ).toBeVisible();
    await expect(
      neighborhood.locator(
        '[data-testid="dep-graph-node"][data-id="seed-epic-d"]',
      ),
    ).toBeVisible();
    await expect(
      neighborhood.locator(
        '[data-testid="dep-graph-node"][data-id="seed-epic-c"]',
      ),
    ).toHaveCount(0);

    await expect(neighborhood.getByText("Blocked by")).toBeVisible();
    await expect(neighborhood.getByText("seed-epic-a")).toBeVisible();

    // Clear blockedBy, reload, then restore.
    await neighborhood.getByText("seed-epic-a").first().click();
    const input = neighborhood.getByPlaceholder("space-separated epic ids");
    await expect(input).toBeVisible();
    await input.fill("");
    await input.press("Enter");
    await expect(neighborhood.getByText("nothing")).toBeVisible();

    await page.reload({ waitUntil: "load" });
    const afterClear = page
      .getByRole("main")
      .locator('[data-testid="epic-dep-neighborhood"]');
    await expect(afterClear.getByText("nothing")).toBeVisible();

    await afterClear.getByText("nothing").click();
    const restore = afterClear.getByPlaceholder("space-separated epic ids");
    await restore.fill("seed-epic-a");
    await restore.press("Enter");
    await expect(afterClear.getByText("seed-epic-a")).toBeVisible();

    await page.reload({ waitUntil: "load" });
    await expect(
      page
        .getByRole("main")
        .locator('[data-testid="epic-dep-neighborhood"]')
        .getByText("seed-epic-a"),
    ).toBeVisible();
  });
});
