import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test as base, expect } from "@playwright/test";
import { bootSeededApp } from "./fixtures";
import { createGhStub, ghPullRequest } from "./gh-stub";

const READY_HEAD = "abc123def456";
const READY_PR_URL = "https://github.com/acme/widgets/pull/1";
const DRAFT_PR_URL = "https://github.com/acme/widgets/pull/2";

type PrLoopApp = {
  baseURL: string;
  readyStoryId: string;
  draftStoryId: string;
  mergeCalls: { args: string[]; cwd: string }[];
};

const test = base.extend<Record<string, never>, { prLoopApp: PrLoopApp }>({
  prLoopApp: [
    async ({}, use) => {
      const workspace = mkdtempSync(join(tmpdir(), "it-e2e-pr-loop-ws-"));
      mkdirSync(join(workspace, ".git"));

      const { spawner, mergeCalls } = createGhStub({
        1: ghPullRequest({
          number: 1,
          url: READY_PR_URL,
          headRefOid: READY_HEAD,
          reviewDecision: "APPROVED",
        }),
        2: ghPullRequest({
          number: 2,
          url: DRAFT_PR_URL,
          isDraft: true,
          mergeStateStatus: "DRAFT",
          reviewDecision: null,
        }),
      });

      let readyStoryId = "";
      let draftStoryId = "";

      const app = await bootSeededApp({
        ghSpawner: spawner,
        afterApply: async ({ update, create }) => {
          await update("seed-proj", { workspace });

          const ready = await create({
            kind: "story",
            title: "Ready PR story",
            partOf: "seed-epic-b",
          });
          await update(ready.id, {
            prUrl: READY_PR_URL,
            branchName: "feat/ready",
          });
          readyStoryId = ready.id;

          const draft = await create({
            kind: "story",
            title: "Draft PR story",
            partOf: "seed-epic-b",
          });
          await update(draft.id, {
            prUrl: DRAFT_PR_URL,
            branchName: "feat/draft",
          });
          draftStoryId = draft.id;
        },
      });

      await use({
        baseURL: app.baseURL,
        readyStoryId,
        draftStoryId,
        mergeCalls,
      });

      await app.stop();
    },
    { scope: "worker" },
  ],
});

test.describe("PR delivery loop", () => {
  test("lands a ready PR from the detail panel and blocks draft PRs", async ({
    page,
    prLoopApp,
  }) => {
    const { baseURL, readyStoryId, draftStoryId } = prLoopApp;

    await page.goto(
      `${baseURL}/projects/seed-proj/issues/${readyStoryId}`,
    );
    const main = page.getByRole("main");
    await expect(main.getByText("Ready PR story").first()).toBeVisible();

    const panel = main.getByTestId("pr-status-panel");
    await expect(panel).toHaveAttribute("data-state", "ready");
    await expect(panel.getByText("Ready for review")).toBeVisible();
    await expect(panel.getByText("Mergeable")).toBeVisible();
    await expect(panel.getByTestId("pr-merge-open")).toBeVisible();

    await panel.getByTestId("pr-merge-open").click();
    const dialog = page.getByTestId("merge-pr-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(READY_HEAD)).toBeVisible();
    await dialog.getByTestId("merge-pr-confirm").click();
    await expect(dialog).toHaveCount(0);

    expect(prLoopApp.mergeCalls).toEqual([
      expect.objectContaining({
        args: [
          "pr",
          "merge",
          "1",
          "--merge",
          "-R",
          "acme/widgets",
          "--match-head-commit",
          READY_HEAD,
        ],
      }),
    ]);

    await page.goto(
      `${baseURL}/projects/seed-proj/issues/${draftStoryId}`,
    );
    await expect(main.getByText("Draft PR story").first()).toBeVisible();

    const draftPanel = main.getByTestId("pr-status-panel");
    await expect(draftPanel).toHaveAttribute("data-state", "draft");
    await expect(draftPanel.getByText("Draft", { exact: true })).toBeVisible();
    await expect(draftPanel.getByTestId("pr-merge-open")).toHaveCount(0);
    await expect(draftPanel.getByTestId("pr-auto-merge-open")).toHaveCount(0);
    await expect(draftPanel.getByText(/mark ready|un-?draft/i)).toHaveCount(0);
    await expect(
      draftPanel.getByText(
        "This pull request is a draft and must be marked ready on GitHub.",
      ),
    ).toBeVisible();
    await expect(draftPanel.getByTestId("pr-merge-github-link")).toHaveCount(0);
    await expect(draftPanel.getByText("Open on GitHub")).toHaveCount(0);
    await expect(draftPanel.getByTestId("pr-number-link")).toHaveAttribute(
      "href",
      DRAFT_PR_URL,
    );
  });
});
