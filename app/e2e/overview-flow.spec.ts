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
    const dependenciesTab = tablist.getByRole("tab", { name: "Dependencies" });

    await expect(flowTab).toHaveAttribute("aria-selected", "true");
    await expect(structureTab).toHaveAttribute("aria-selected", "false");
    await expect(dependenciesTab).toHaveAttribute("aria-selected", "false");
    await expect(page).not.toHaveURL(/[?&]lens=/);

    await structureTab.click();
    await expect(page).toHaveURL(/[?&]lens=structure(?:&|$)/);
    await expect(structureTab).toHaveAttribute("aria-selected", "true");
    await expect(flowTab).toHaveAttribute("aria-selected", "false");
    const structurePanel = page.getByRole("tabpanel", { name: "Structure" });
    await expect(structurePanel).toBeVisible();
    await expect(
      structurePanel.getByRole("heading", { name: "Ideas" }),
    ).toBeVisible();
    await expect(
      structurePanel.getByText(
        "No ideas yet. Name what to plan next, then capture it here.",
      ),
    ).toBeVisible();
    await expect(
      structurePanel.getByRole("button", { name: "New idea" }),
    ).toBeVisible();
    await expect(
      structurePanel.getByRole("button", { name: "New story" }),
    ).toBeVisible();
    await expect(
      structurePanel.getByRole("button", { name: "New epic" }),
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
    await expect(
      page
        .getByRole("tabpanel", { name: "Structure" })
        .getByRole("button", { name: "New epic" }),
    ).toBeVisible();

    await page
      .getByRole("tablist", { name: "Overview lens" })
      .getByRole("tab", { name: "Dependencies" })
      .click();
    await expect(page).toHaveURL(/[?&]lens=dependencies(?:&|$)/);
    await expect(page.getByRole("tabpanel", { name: "Dependencies" })).toBeVisible();
    await expect(page.getByRole("tabpanel", { name: "Structure" })).toHaveCount(
      0,
    );

    await page
      .getByRole("tablist", { name: "Overview lens" })
      .getByRole("tab", { name: "Flow" })
      .click();
    await expect(page).not.toHaveURL(/[?&]lens=/);
    await expect(page.getByRole("tabpanel", { name: "Flow" })).toBeVisible();
    await expect(page.locator("[data-lens-mount]")).toHaveCount(0);
  });

  test("Flow buckets match the seeded project tree", async ({
    page,
    seededApp,
  }) => {
    const main = await gotoOverviewFlow(page, seededApp.baseURL);

    // Seed → project-scoped flowBuckets (see e2e/fixtures.ts): Ready has Epic A
    // and the not-started "Story in flight"; B/C/D are blocked; merged story is
    // recently merged; In flight is empty until a Story has branchName / pr-open.
    // Heading accessible names concatenate label + count without a space.
    const ready = bucketSection(main, "ready");
    await expect(ready.getByRole("heading", { name: "Ready2" })).toBeVisible();
    await expect(ready.getByRole("link", { name: /^Epic A\b/ })).toBeVisible();
    await expect(
      ready.getByRole("link", { name: /^Story in flight\b/ }),
    ).toBeVisible();

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
      merged.getByRole("heading", { name: "Recently merged1" }),
    ).toBeVisible();
    await expect(
      merged.getByRole("link", { name: /^Merged story\b/ }),
    ).toBeVisible();
  });

  test("inline needs-attention toggle persists across reload", async ({
    page,
    seededApp,
  }) => {
    const main = await gotoOverviewFlow(page, seededApp.baseURL);

    const row = main
      .getByRole("listitem")
      .filter({ hasText: "Story in flight" });
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
      .filter({ hasText: "Story in flight" });
    await rowAfter.hover();
    await expect(
      rowAfter.getByRole("button", { name: "Clear needs attention" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  test("Structure idea capture creates an Idea outside Flow", async ({
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
    await expect(
      structurePanel.getByText(
        "No ideas yet. Name what to plan next, then capture it here.",
      ),
    ).toBeVisible();

    await structurePanel.getByLabel("Idea title").fill("Capture me next");
    await structurePanel.getByRole("button", { name: "New idea" }).click();

    await expect(
      structurePanel.getByRole("link", { name: /^Capture me next\b/ }),
    ).toBeVisible();
    await expect(
      structurePanel.getByText(
        "No ideas yet. Name what to plan next, then capture it here.",
      ),
    ).toHaveCount(0);

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
      page
        .getByRole("main")
        .getByRole("link", { name: /^Story in flight\b/ }),
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

async function gotoOverviewDependencies(
  page: Page,
  baseURL: string,
): Promise<Locator> {
  await page.goto(`${baseURL}/projects/seed-proj?lens=dependencies`);
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { name: "Seed Project" })).toBeVisible();
  await expect(
    page.getByRole("tablist", { name: "Overview lens" }),
  ).toBeVisible();
  await expect(
    page.getByRole("tabpanel", { name: "Dependencies" }),
  ).toBeVisible();
  return main;
}

test.describe("overview Dependencies lens", () => {
  test("renders the seeded diamond DAG with node states and drill-down links", async ({
    page,
    seededApp,
  }) => {
    const main = await gotoOverviewDependencies(page, seededApp.baseURL);

    const nodes = main.locator('[data-testid="dep-graph-node"]');
    await expect(nodes).toHaveCount(4);

    await expect(
      main.locator('[data-testid="dep-graph-node"][data-id="seed-epic-a"]'),
    ).toHaveAttribute("data-state", "ready");
    await expect(
      main.locator('[data-testid="dep-graph-node"][data-id="seed-epic-b"]'),
    ).toHaveAttribute("data-state", "blocked");
    await expect(
      main.locator('[data-testid="dep-graph-node"][data-id="seed-epic-c"]'),
    ).toHaveAttribute("data-state", "blocked");
    await expect(
      main.locator('[data-testid="dep-graph-node"][data-id="seed-epic-d"]'),
    ).toHaveAttribute("data-state", "blocked");

    const edges = main.locator('[data-testid="dep-graph-edge"]');
    await expect(edges).toHaveCount(4);
    await expect(edges.filter({ hasNot: page.locator('[data-satisfied="true"]') })).toHaveCount(4);

    await main.getByRole("link", { name: /^Epic A\b/ }).click();
    await expect(page).toHaveURL(
      /\/projects\/seed-proj\/issues\/seed-epic-a\/?$/,
    );
  });

  // Sole both-theme key-surface snapshot for the project Dependencies overview.
  test("both-theme Dependencies key-surface snapshot", async ({ page, seededApp }) => {
    await gotoOverviewDependencies(page, seededApp.baseURL);
    await expect(
      page.getByRole("main").getByRole("link", { name: /^Epic A\b/ }),
    ).toBeVisible();
    await snapshotBothThemes(page, "overview-dependencies");
  });
});
