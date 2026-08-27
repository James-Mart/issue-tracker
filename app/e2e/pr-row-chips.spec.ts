import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Locator, Page } from "@playwright/test";
import { test as base, expect } from "@playwright/test";
import { bootSeededApp } from "./fixtures";
import { createGhStub, ghPullRequest } from "./gh-stub";
import { gotoOverviewStructure } from "./seed-navigation";

const PR_URL = "https://github.com/acme/widgets/pull/1";
const CHIP_LABEL = "Ready · Success · Approved · 0 comments";

type PrChipApp = {
  baseURL: string;
};

const test = base.extend<Record<string, never>, { prChipApp: PrChipApp }>({
  prChipApp: [
    async ({}, use) => {
      const workspace = mkdtempSync(join(tmpdir(), "it-e2e-pr-chips-ws-"));
      mkdirSync(join(workspace, ".git"));

      const { spawner } = createGhStub({
        1: ghPullRequest({
          number: 1,
          url: PR_URL,
          reviewDecision: "APPROVED",
        }),
      });

      const app = await bootSeededApp({
        ghSpawner: spawner,
        afterApply: async ({ update, create }) => {
          await update("seed-proj", { workspace });

          await update("seed-story-flight", {
            prUrl: PR_URL,
            branchName: "feat/in-flight",
          });

          const withPr = await create({
            kind: "story",
            title: "Flow story with PR",
            partOf: "seed-proj",
          });
          await update(withPr.id, {
            prUrl: PR_URL,
            branchName: "feat/flow-pr",
          });

          const withoutPr = await create({
            kind: "story",
            title: "Flow story without PR",
            partOf: "seed-proj",
          });
          await update(withoutPr.id, { branchName: "feat/no-pr" });
        },
      });

      await use({ baseURL: app.baseURL });

      await app.stop();
    },
    { scope: "worker" },
  ],
});

function storyRow(main: Locator, title: string): Locator {
  return main.getByRole("listitem").filter({ hasText: title });
}

test.describe("PR row chips", () => {
  test("shows the live PR chip on PR-bearing Stories in Structure", async ({
    page,
    prChipApp,
  }) => {
    const { baseURL } = prChipApp;
    let prFetchCount = 0;

    await page.route("**/api/projects/seed-proj/prs", async (route) => {
      prFetchCount += 1;
      await route.continue();
    });

    const structure = await gotoOverviewStructure(page, baseURL);

    const nestedWithPr = storyRow(structure, "Story in flight");
    await nestedWithPr.hover();
    await expect(
      nestedWithPr.getByTestId("pr-chip"),
    ).toHaveText(CHIP_LABEL);

    const nestedNoPr = storyRow(structure, "Merged story");
    await nestedNoPr.hover();
    await expect(nestedNoPr.getByTestId("pr-chip")).toHaveCount(0);

    const topWithPr = storyRow(structure, "Flow story with PR");
    await topWithPr.hover();
    await expect(topWithPr.getByTestId("pr-chip")).toHaveText(CHIP_LABEL);

    const topNoPr = storyRow(structure, "Flow story without PR");
    await topNoPr.hover();
    await expect(topNoPr.getByTestId("pr-chip")).toHaveCount(0);

    expect(prFetchCount).toBe(1);

    await page.waitForTimeout(1500);
    expect(prFetchCount).toBe(1);
  });

  test("mirrors the PR chip label in the Structure touch overflow menu", async ({
    page,
    prChipApp,
  }) => {
    await page.addInitScript(() => {
      const original = window.matchMedia.bind(window);
      window.matchMedia = (query: string) => {
        if (query === "(pointer: coarse)") {
          return {
            matches: true,
            media: query,
            addEventListener: () => {},
            removeEventListener: () => {},
            addListener: () => {},
            removeListener: () => {},
            dispatchEvent: () => false,
            onchange: null,
          } as MediaQueryList;
        }
        return original(query);
      };
    });

    const main = await gotoOverviewStructure(page, prChipApp.baseURL);

    const withPr = storyRow(main, "Flow story with PR");
    await expect(withPr.getByTitle("Row actions")).toBeVisible();
    await withPr.getByTitle("Row actions").click();
    await expect(
      page.getByRole("menuitem", { name: CHIP_LABEL }),
    ).toBeVisible();
    await expect(page.getByTestId("pr-chip")).toHaveCount(0);

    await page.keyboard.press("Escape");

    const noPr = storyRow(main, "Flow story without PR");
    await noPr.getByTitle("Row actions").click();
    await expect(
      page.getByRole("menuitem", { name: CHIP_LABEL }),
    ).toHaveCount(0);
  });
});
