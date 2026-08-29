import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Locator, Page } from "@playwright/test";
import { test as base, expect } from "@playwright/test";
import { bootSeededApp } from "./fixtures";

const CEILING_BYTES = "2048";
const UNREACHABLE_SHA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const NAMES = [
  "alpha",
  "bravo",
  "charlie",
  "delta",
  "echo",
  "foxtrot",
  "golf",
  "hotel",
  "india",
  "juliet",
  "kilo",
  "lima",
  "mike",
  "november",
  "oscar",
  "papa",
  "quebec",
  "romeo",
  "sierra",
  "tango",
].join("\n") + "\n";

const GIT_IDENTITY = ["-c", "user.name=e2e", "-c", "user.email=e2e@example.com"];

function git(repo: string, args: string[]): string {
  return execFileSync("git", [...GIT_IDENTITY, ...args], {
    cwd: repo,
    encoding: "utf8",
  }).trim();
}

function writeRepoFile(repo: string, rel: string, contents: string): void {
  const dest = join(repo, rel);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, contents);
}

function commit(repo: string, message: string): string {
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-m", message]);
  return git(repo, ["rev-parse", "HEAD"]);
}

function seedFixtureRepo(): {
  workspace: string;
  namesSha: string;
  alphaSha: string;
  bravoSha: string;
  oversizedSha: string;
} {
  const workspace = mkdtempSync(join(tmpdir(), "it-e2e-diff-tab-ws-"));
  git(workspace, ["init", "-b", "main"]);
  writeRepoFile(workspace, "names.txt", NAMES);
  writeRepoFile(workspace, "src/alpha.ts", "export const alpha = 1;\n");
  writeRepoFile(workspace, "src/bravo.ts", "export const bravo = 1;\n");
  commit(workspace, "Initial fixture files");

  writeRepoFile(workspace, "names.txt", NAMES.replace("india\n", "INDIA\n"));
  const namesSha = commit(workspace, "Rename india");

  writeRepoFile(workspace, "src/alpha.ts", "export const alpha = 2;\n");
  const alphaSha = commit(workspace, "Bump alpha");

  writeRepoFile(workspace, "src/bravo.ts", "export const bravo = 2;\n");
  const bravoSha = commit(workspace, "Bump bravo");

  writeRepoFile(workspace, "huge.txt", `${"x".repeat(80)}\n`.repeat(80));
  const oversizedSha = commit(workspace, "Add a change past the render ceiling");

  return { workspace, namesSha, alphaSha, bravoSha, oversizedSha };
}

type DiffTabApp = {
  baseURL: string;
  namesTaskId: string;
  rollupStoryId: string;
  epicId: string;
  unreachableTaskId: string;
  oversizedTaskId: string;
  namesSha: string;
};

const test = base.extend<Record<string, never>, { diffTabApp: DiffTabApp }>({
  diffTabApp: [
    async ({}, use) => {
      const fixture = seedFixtureRepo();
      const previousCeiling = process.env.ISSUE_TRACKER_MAX_PATCH_BYTES;
      process.env.ISSUE_TRACKER_MAX_PATCH_BYTES = CEILING_BYTES;

      let namesTaskId = "";
      let rollupStoryId = "";
      let epicId = "";
      let unreachableTaskId = "";
      let oversizedTaskId = "";

      const app = await bootSeededApp({
        afterApply: async ({ update, create }) => {
          await update("seed-proj", { workspace: fixture.workspace });

          const epic = await create({
            kind: "epic",
            title: "Diff rollup epic",
            partOf: "seed-proj",
          });
          epicId = epic.id;
          const story = await create({
            kind: "story",
            title: "Diff rollup story",
            partOf: epic.id,
          });
          rollupStoryId = story.id;
          const namesTask = await create({
            kind: "task",
            title: "Record names change",
            partOf: story.id,
          });
          namesTaskId = namesTask.id;
          const alphaTask = await create({
            kind: "task",
            title: "Record alpha change",
            partOf: story.id,
          });
          const bravoTask = await create({
            kind: "task",
            title: "Record bravo change",
            partOf: story.id,
          });
          await update(namesTask.id, {
            status: "done",
            commitSha: fixture.namesSha,
          });
          await update(alphaTask.id, {
            status: "done",
            commitSha: fixture.alphaSha,
          });
          await update(bravoTask.id, {
            status: "done",
            commitSha: fixture.bravoSha,
          });

          const faultStory = await create({
            kind: "story",
            title: "Diff fault story",
            partOf: "seed-epic-a",
          });
          const unreachable = await create({
            kind: "task",
            title: "Unreachable commit task",
            partOf: faultStory.id,
          });
          unreachableTaskId = unreachable.id;
          const oversized = await create({
            kind: "task",
            title: "Oversized change task",
            partOf: faultStory.id,
          });
          oversizedTaskId = oversized.id;
          await update(unreachable.id, {
            status: "done",
            commitSha: UNREACHABLE_SHA,
          });
          await update(oversized.id, {
            status: "done",
            commitSha: fixture.oversizedSha,
          });
        },
      });

      await use({
        baseURL: app.baseURL,
        namesTaskId,
        rollupStoryId,
        epicId,
        unreachableTaskId,
        oversizedTaskId,
        namesSha: fixture.namesSha,
      });

      await app.stop();
      rmSync(fixture.workspace, { recursive: true, force: true });
      if (previousCeiling === undefined) {
        delete process.env.ISSUE_TRACKER_MAX_PATCH_BYTES;
      } else {
        process.env.ISSUE_TRACKER_MAX_PATCH_BYTES = previousCeiling;
      }
    },
    { scope: "worker" },
  ],
});

async function openIssue(page: Page, baseURL: string, issueId: string): Promise<Locator> {
  await page.goto(`${baseURL}/projects/seed-proj/issues/${issueId}`);
  return page.getByRole("main");
}

async function openDiffTab(
  page: Page,
  baseURL: string,
  issueId: string,
): Promise<Locator> {
  const main = await openIssue(page, baseURL, issueId);
  const tablist = main.getByRole("tablist", { name: "Issue detail" });
  await tablist.getByRole("tab", { name: "Diff" }).click();
  await expect(page).toHaveURL(/[?&]tab=diff(?:&|$)/);
  await expect(tablist.getByRole("tab", { name: "Diff" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  return main;
}

async function gotoDiff(
  page: Page,
  baseURL: string,
  issueId: string,
): Promise<Locator> {
  await page.goto(`${baseURL}/projects/seed-proj/issues/${issueId}?tab=diff`);
  const main = page.getByRole("main");
  await expect(main.getByRole("tab", { name: "Diff" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  return main;
}

test.describe("Diff tab", () => {
  test("opens on a Task and renders its commit", async ({ page, diffTabApp }) => {
    const main = await openDiffTab(page, diffTabApp.baseURL, diffTabApp.namesTaskId);
    const panel = main.getByTestId("issue-change-panel");
    await expect(panel).toBeVisible();
    await expect(main.getByTestId("issue-change-scope-header")).toContainText(
      diffTabApp.namesSha.slice(0, 7),
    );
    await expect(main.getByTestId("issue-change-scope-header")).toContainText(
      "1 file",
    );
    const file = main.getByTestId("issue-change-file-diff");
    await expect(file).toHaveAttribute("data-file-name", "names.txt");
    await expect(file.getByText("INDIA", { exact: true })).toBeVisible();
  });

  test("opens on a Story and renders the combined change", async ({
    page,
    diffTabApp,
  }) => {
    const main = await openDiffTab(
      page,
      diffTabApp.baseURL,
      diffTabApp.rollupStoryId,
    );
    const panel = main.getByTestId("issue-change-panel");
    await expect(panel).toBeVisible();
    await expect(main.getByTestId("issue-change-scope-header")).toHaveText(
      "3 files +3 -3 3 commits",
    );
    await expect(main.getByTestId("issue-change-file-diff")).toHaveCount(3);
    await expect(
      main.locator('[data-testid="issue-change-file-diff"][data-file-name="names.txt"]'),
    ).toBeVisible();
    await expect(
      main.locator('[data-testid="issue-change-file-diff"][data-file-name="src/alpha.ts"]'),
    ).toBeVisible();
    await expect(
      main.locator('[data-testid="issue-change-file-diff"][data-file-name="src/bravo.ts"]'),
    ).toBeVisible();
  });

  test("Epic detail has no Diff tab and ignores ?tab=diff", async ({
    page,
    diffTabApp,
  }) => {
    const main = await openIssue(page, diffTabApp.baseURL, diffTabApp.epicId);
    const tablist = main.getByRole("tablist", { name: "Issue detail" });
    await expect(tablist.getByRole("tab", { name: "Diff" })).toHaveCount(0);
    await expect(tablist.getByRole("tab", { name: "Overview" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(tablist.getByRole("tab", { name: "Implementing" })).toBeVisible();

    await page.goto(
      `${diffTabApp.baseURL}/projects/seed-proj/issues/${diffTabApp.epicId}?tab=diff`,
    );
    await expect(page).not.toHaveURL(/[?&]tab=diff(?:&|$)/);
    const tablistAfter = page
      .getByRole("main")
      .getByRole("tablist", { name: "Issue detail" });
    await expect(tablistAfter.getByRole("tab", { name: "Diff" })).toHaveCount(0);
    await expect(tablistAfter.getByRole("tab", { name: "Overview" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  test("change endpoints refuse an Epic id", async ({ request, diffTabApp }) => {
    const changeRes = await request.get(
      `${diffTabApp.baseURL}/api/issues/${diffTabApp.epicId}/change`,
    );
    expect(changeRes.status()).toBe(400);
    const changeBody = await changeRes.json();
    expect(changeBody.code).toBe("validation");
    expect(changeBody.error).toContain("Epic diffs are not supported");

    const fileUrl = new URL(
      `${diffTabApp.baseURL}/api/issues/${diffTabApp.epicId}/change/file`,
    );
    fileUrl.searchParams.set("path", "names.txt");
    fileUrl.searchParams.set("sha", diffTabApp.namesSha);
    const fileRes = await request.get(fileUrl.toString());
    expect(fileRes.status()).toBe(400);
    const fileBody = await fileRes.json();
    expect(fileBody.code).toBe("validation");
    expect(fileBody.error).toContain("Epic diffs are not supported");
  });

  test("file navigator filters and moves the view", async ({ page, diffTabApp }) => {
    const main = await gotoDiff(page, diffTabApp.baseURL, diffTabApp.rollupStoryId);
    const navigator = main.getByTestId("issue-change-file-navigator");
    await expect(navigator).toBeVisible();
    await expect(main.getByTestId("issue-change-file")).toHaveCount(3);
    await expect(main.getByTestId("issue-change-file-match-count")).toHaveText(
      "3 of 3",
    );

    await main.getByTestId("issue-change-file-filter").fill("bravo");
    await expect(main.getByTestId("issue-change-file")).toHaveCount(1);
    await expect(main.getByTestId("issue-change-file-match-count")).toHaveText(
      "1 of 3",
    );
    await expect(
      main.getByTestId("issue-change-file").getByText("src/bravo.ts"),
    ).toBeVisible();
    await expect(main.getByTestId("issue-change-file-diff")).toHaveCount(1);
    await expect(main.getByTestId("issue-change-file-diff")).toHaveAttribute(
      "data-file-name",
      "src/bravo.ts",
    );

    await main.getByTestId("issue-change-file-filter").fill("");
    await expect(main.getByTestId("issue-change-file")).toHaveCount(3);

    const alpha = main.locator(
      '[data-testid="issue-change-file"][data-file-name="src/alpha.ts"]',
    );
    await alpha.click();
    await expect(alpha).toHaveAttribute("aria-selected", "true");
    const alphaDiff = main.locator(
      '[data-testid="issue-change-file-diff"][data-file-name="src/alpha.ts"]',
    );
    await expect(alphaDiff).toBeVisible();
    await expect(alphaDiff).toBeInViewport();
  });

  test("context expands beyond the hunk", async ({ page, diffTabApp }) => {
    const main = await gotoDiff(page, diffTabApp.baseURL, diffTabApp.namesTaskId);
    const file = main.getByTestId("issue-change-file-diff");
    await expect(file.getByText("INDIA", { exact: true })).toBeVisible();
    await expect(file.getByText("alpha", { exact: true })).toHaveCount(0);

    const expandDown = file.locator("[data-expand-button][data-expand-down]").first();
    await expect(expandDown).toBeAttached();
    await expandDown.click({ force: true });

    const loading = file.getByTestId("issue-change-context-loading");
    if (await loading.isVisible().catch(() => false)) {
      await expect(loading).toHaveCount(0);
    }
    await expect(file.getByText("alpha", { exact: true })).toBeVisible();

    const expandUp = file.locator("[data-expand-button][data-expand-up]").first();
    if (await expandUp.isVisible().catch(() => false)) {
      await expandUp.click({ force: true });
    }
    await expect(file.getByText("tango", { exact: true })).toBeVisible();
  });

  test("layout toggle switches between unified and split", async ({
    page,
    diffTabApp,
  }) => {
    const main = await gotoDiff(page, diffTabApp.baseURL, diffTabApp.namesTaskId);
    const toggle = main.getByTestId("diff-layout-toggle");
    await expect(toggle).toBeVisible();
    await expect(toggle.getByRole("button", { name: "Unified" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(main.locator('[data-diff-type="split"]')).toHaveCount(0);

    await toggle.getByRole("button", { name: "Split" }).click();
    await expect(toggle.getByRole("button", { name: "Split" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(main.locator('[data-diff-type="split"]').first()).toBeVisible();

    await toggle.getByRole("button", { name: "Unified" }).click();
    await expect(toggle.getByRole("button", { name: "Unified" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(main.locator('[data-diff-type="split"]')).toHaveCount(0);
  });

  test("an issue with no recorded commits shows its empty state", async ({
    page,
    diffTabApp,
  }) => {
    const main = await gotoDiff(page, diffTabApp.baseURL, "seed-task-flight");
    const empty = main.getByTestId("issue-change-empty-state");
    await expect(empty).toBeVisible();
    await expect(empty).toHaveAttribute("data-empty-reason", "no-commit");
    await expect(empty.getByText("No commit recorded for this task yet.")).toBeVisible();
    await expect(main.getByTestId("issue-change-panel")).toHaveCount(0);
  });

  test("an unreachable commit shows its fault", async ({ page, diffTabApp }) => {
    const main = await gotoDiff(
      page,
      diffTabApp.baseURL,
      diffTabApp.unreachableTaskId,
    );
    const fault = main.getByTestId("issue-change-fault-state");
    await expect(fault).toBeVisible();
    await expect(fault).toHaveAttribute("data-fault", "commit-unreachable");
    await expect(fault.getByText("Commit not found in workspace")).toBeVisible();
    await expect(main.getByTestId("issue-change-panel")).toHaveCount(0);
  });

  test("a change past a lowered ceiling shows the too-large refusal", async ({
    page,
    diffTabApp,
  }) => {
    const main = await gotoDiff(
      page,
      diffTabApp.baseURL,
      diffTabApp.oversizedTaskId,
    );
    const refusal = main.getByTestId("issue-change-too-large-state");
    await expect(refusal).toBeVisible();
    await expect(
      refusal.getByText("This change is too large to render in the browser."),
    ).toBeVisible();
    await expect(refusal.getByText("git show <commit-sha>")).toBeVisible();
    await expect(main.getByTestId("issue-change-panel")).toHaveCount(0);
    await expect(main.getByTestId("issue-change-fault-state")).toHaveCount(0);
  });
});
