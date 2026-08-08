import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { gotoOverviewStructure } from "./seed-navigation";
import { snapshotBothThemes } from "./snapshot-both-themes";

async function gotoOverviewFlow(page: Page, baseURL: string): Promise<Locator> {
  await page.goto(`${baseURL}/projects/seed-proj`);
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { name: "Seed Project" })).toBeVisible();
  await expect(
    page.getByRole("tablist", { name: "Overview lens" }),
  ).toBeVisible();
  await expect(page.getByRole("tabpanel", { name: "Flow" })).toBeVisible();
  return main;
}

function bucketSection(
  main: Locator,
  key: "ready" | "inFlight" | "blocked" | "recentlyMerged",
): Locator {
  return main.locator(`section[aria-labelledby="overview-flow-${key}"]`);
}

test.describe("overview Flow lens", () => {
  test("lens switcher persists selection and mounts Structure content", async ({
    page,
    seededApp,
  }) => {
    await gotoOverviewFlow(page, seededApp.baseURL);

    const tablist = page.getByRole("tablist", { name: "Overview lens" });
    const flowTab = tablist.getByRole("tab", { name: "Flow" });
    const structureTab = tablist.getByRole("tab", { name: "Structure" });
    const sharedSearch = page.getByRole("main").getByLabel("Search overview");

    await expect(flowTab).toHaveAttribute("aria-selected", "true");
    await expect(structureTab).toHaveAttribute("aria-selected", "false");
    await expect(
      tablist.getByRole("tab", { name: "Dependencies" }),
    ).toHaveCount(0);
    await expect(page).not.toHaveURL(/[?&]lens=/);
    await expect(sharedSearch).toBeVisible();
    await expect(page.getByRole("main").getByRole("button", { name: "New" })).toBeVisible();

    await structureTab.click();
    await expect(page).toHaveURL(/[?&]lens=structure(?:&|$)/);
    await expect(structureTab).toHaveAttribute("aria-selected", "true");
    await expect(flowTab).toHaveAttribute("aria-selected", "false");
    const structurePanel = page.getByRole("tabpanel", { name: "Structure" });
    await expect(structurePanel).toBeVisible();
    await expect(sharedSearch).toBeVisible();
    await expect(
      structurePanel.getByLabel("Search overview"),
    ).toHaveCount(0);
    await expect(
      structurePanel.getByRole("button", { name: "New" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("main").getByRole("button", { name: "New" }),
    ).toBeVisible();
    await expect(
      structurePanel.getByRole("link", { name: /^Epic A\b/ }),
    ).toBeVisible();
    await expect(page.getByRole("tabpanel", { name: "Flow" })).toHaveCount(0);

    await page.reload({ waitUntil: "load" });
    await expect(page).toHaveURL(/[?&]lens=structure(?:&|$)/);
    await expect(
      page.getByRole("tablist", { name: "Overview lens" }).getByRole("tab", {
        name: "Structure",
      }),
    ).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("tabpanel", { name: "Structure" })).toBeVisible();
    await expect(page.getByRole("main").getByRole("button", { name: "New" })).toBeVisible();
    await expect(page.getByRole("main").getByLabel("Search overview")).toBeVisible();

    await page
      .getByRole("tablist", { name: "Overview lens" })
      .getByRole("tab", { name: "Flow" })
      .click();
    await expect(page).not.toHaveURL(/[?&]lens=/);
    await expect(page.getByRole("tabpanel", { name: "Flow" })).toBeVisible();
    await expect(page.getByRole("main").getByLabel("Search overview")).toBeVisible();
    await expect(
      page.getByRole("tabpanel", { name: "Flow" }).getByLabel("Search overview"),
    ).toHaveCount(0);
  });

  test("Flow buckets match the seeded project tree", async ({
    page,
    seededApp,
  }) => {
    const main = await gotoOverviewFlow(page, seededApp.baseURL);

    // Seed → project-scoped flowBuckets (see e2e/fixtures.ts): Ready has Epic A
    // only; B/C/D are blocked (child story state rolls into Epic B); In flight
    // is empty until a top-level Story has branchName / pr-open.
    // Heading accessible names concatenate label + count without a space.
    const ready = bucketSection(main, "ready");
    await expect(ready.getByRole("heading", { name: "Ready1" })).toBeVisible();
    await expect(ready.getByRole("link", { name: /^Epic A\b/ })).toBeVisible();
    await expect(
      ready.getByRole("link", { name: /^Story in flight\b/ }),
    ).toHaveCount(0);

    const inFlight = bucketSection(main, "inFlight");
    await expect(
      inFlight.getByRole("heading", { name: "In flight0" }),
    ).toBeVisible();
    await expect(
      inFlight.getByText(
        "Nothing in flight. Pick up Ready work or start a Story.",
      ),
    ).toBeVisible();

    const blocked = bucketSection(main, "blocked");
    await expect(
      blocked.getByRole("heading", { name: "Blocked3" }),
    ).toBeVisible();
    await expect(blocked.getByRole("link", { name: /^Epic B\b/ })).toBeVisible();
    await expect(blocked.getByRole("link", { name: /^Epic C\b/ })).toBeVisible();
    await expect(blocked.getByRole("link", { name: /^Epic D\b/ })).toBeVisible();

    const merged = bucketSection(main, "recentlyMerged");
    await expect(
      merged.getByRole("heading", { name: "Recently merged0" }),
    ).toBeVisible();
    await expect(
      merged.getByText(
        "Nothing merged recently. Finish a Story to land it here.",
      ),
    ).toBeVisible();
  });

  test("inline needs-attention toggle persists across reload", async ({
    page,
    seededApp,
  }) => {
    const main = await gotoOverviewFlow(page, seededApp.baseURL);

    const row = main
      .getByRole("listitem")
      .filter({ hasText: "Epic A" });
    await row.hover();

    const flag = row.getByRole("button", { name: "Flag needs attention" });
    await expect(flag).toBeVisible();
    await flag.click();

    const clear = row.getByRole("button", { name: "Clear needs attention" });
    await expect(clear).toHaveAttribute("aria-pressed", "true");

    await page.reload({ waitUntil: "load" });
    await expect(page.getByRole("tabpanel", { name: "Flow" })).toBeVisible();

    const rowAfter = page
      .getByRole("main")
      .getByRole("listitem")
      .filter({ hasText: "Epic A" });
    await rowAfter.hover();
    await expect(
      rowAfter.getByRole("button", { name: "Clear needs attention" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  test("New menu creates an Idea outside Flow", async ({
    page,
    seededApp,
  }) => {
    await gotoOverviewFlow(page, seededApp.baseURL);
    await page
      .getByRole("tablist", { name: "Overview lens" })
      .getByRole("tab", { name: "Structure" })
      .click();

    const structurePanel = page.getByRole("tabpanel", { name: "Structure" });
    await expect(structurePanel).toBeVisible();

    await page.getByRole("main").getByRole("button", { name: "New" }).click();
    await page.getByRole("menuitem", { name: "New idea" }).click();

    const dialog = page.getByTestId("new-issue-dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Title").fill("Capture me next");
    await dialog.getByRole("button", { name: "Create" }).click();

    await expect(dialog).toHaveCount(0);
    const ideasGroup = structurePanel.getByTestId("structure-ideas-group");
    await ideasGroup.locator("summary").click();
    await expect(
      ideasGroup.getByRole("link", { name: /^Capture me next\b/ }),
    ).toBeVisible();

    await page
      .getByRole("tablist", { name: "Overview lens" })
      .getByRole("tab", { name: "Flow" })
      .click();
    const flowPanel = page.getByRole("tabpanel", { name: "Flow" });
    await expect(flowPanel).toBeVisible();
    await expect(
      flowPanel.getByRole("link", { name: /^Capture me next\b/ }),
    ).toHaveCount(0);
  });

  // Sole both-theme key-surface snapshot for the project Flow overview.
  test("both-theme Flow key-surface snapshot", async ({ page, seededApp }) => {
    await gotoOverviewFlow(page, seededApp.baseURL);
    await expect(
      page.getByRole("main").getByRole("link", { name: /^Epic A\b/ }),
    ).toBeVisible();
    await snapshotBothThemes(page, "overview-flow");
  });
});

test.describe("overview Structure lens", () => {
  // Sole both-theme key-surface snapshot for the project Structure overview.
  test("both-theme Structure key-surface snapshot", async ({ page, seededApp }) => {
    await gotoOverviewStructure(page, seededApp.baseURL);
    await expect(
      page.getByRole("main").getByRole("link", { name: /^Epic A\b/ }),
    ).toBeVisible();
    await snapshotBothThemes(page, "overview-structure");
  });
});
