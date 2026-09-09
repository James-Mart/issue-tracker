import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Locator, Page } from "@playwright/test";
import { test as base, expect } from "@playwright/test";
import { bootSeededApp } from "./fixtures";

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

function seedFixtureRepo(): { workspace: string; namesSha: string } {
  const workspace = mkdtempSync(join(tmpdir(), "it-e2e-diff-thread-ws-"));
  git(workspace, ["init", "-b", "main"]);
  writeRepoFile(
    workspace,
    "names.txt",
    "alpha\nbravo\ncharlie\nindia\n",
  );
  commit(workspace, "Initial fixture file");

  writeRepoFile(
    workspace,
    "names.txt",
    "alpha\nbravo\ncharlie\nINDIA\n",
  );
  const namesSha = commit(workspace, "Rename india");

  return { workspace, namesSha };
}

type DiffThreadApp = {
  baseURL: string;
  taskId: string;
};

const test = base.extend<Record<string, never>, { diffThreadApp: DiffThreadApp }>({
  diffThreadApp: [
    async ({}, use) => {
      const fixture = seedFixtureRepo();

      let taskId = "";

      const app = await bootSeededApp({
        afterApply: async ({ update, create }) => {
          await update("seed-proj", { workspace: fixture.workspace });

          const story = await create({
            kind: "story",
            title: "Diff thread story",
            partOf: "seed-epic-a",
          });
          const task = await create({
            kind: "task",
            title: "Record names change",
            partOf: story.id,
          });
          taskId = task.id;
          await update(task.id, {
            status: "done",
            commits: [fixture.namesSha],
          });
        },
      });

      await use({ baseURL: app.baseURL, taskId });

      await app.stop();
      rmSync(fixture.workspace, { recursive: true, force: true });
    },
    { scope: "worker" },
  ],
});

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

function commentsRegion(main: Locator): Locator {
  return main.locator('[data-region="comments"]');
}

test.describe("Diff thread e2e", () => {
  test("starts a line thread, shows it in the log, and replies inline", async ({
    page,
    diffThreadApp,
  }) => {
    const rootMessage = "E2E diff thread root from Playwright";
    const replyMessage = "E2E diff thread reply from Playwright";

    const main = await gotoDiff(page, diffThreadApp.baseURL, diffThreadApp.taskId);
    const file = main.getByTestId("issue-change-file-diff");
    await expect(file).toHaveAttribute("data-file-name", "names.txt");
    await expect(file.getByText("INDIA", { exact: true })).toBeVisible();

    await file.getByText("INDIA", { exact: true }).hover();
    const startThread = file.locator("[data-utility-button]");
    await expect(startThread).toBeVisible();
    await startThread.click();

    const newComposer = main.locator(
      '[data-testid="diff-thread-composer"][data-composer-kind="new"]',
    );
    await expect(newComposer).toBeVisible();
    await newComposer.getByRole("textbox", { name: "Start a review thread" }).fill(
      rootMessage,
    );
    await newComposer.getByRole("button", { name: "Send" }).click();
    await expect(newComposer).toHaveCount(0);

    const inlineThread = file.locator('[data-testid="issue-change-line-threads"]');
    await expect(inlineThread).toBeVisible();
    const threadRoot = inlineThread.locator("[data-thread-root]");
    await expect(threadRoot).toHaveCount(1);
    await expect(threadRoot).toContainText(rootMessage);

    const tablist = main.getByRole("tablist", { name: "Issue detail" });
    await tablist.getByRole("tab", { name: "Overview" }).click();
    await expect(page).not.toHaveURL(/[?&]tab=diff(?:&|$)/);

    const comments = commentsRegion(main);
    await expect(comments).toBeVisible();
    await expect(comments.getByText(rootMessage)).toBeVisible();
    await expect(comments.getByText("No comments yet.")).toHaveCount(0);

    await tablist.getByRole("tab", { name: "Diff" }).click();
    await expect(page).toHaveURL(/[?&]tab=diff(?:&|$)/);
    await expect(threadRoot).toContainText(rootMessage);

    await threadRoot.getByRole("button", { name: "Reply" }).click();
    const replyComposer = main.locator(
      '[data-testid="diff-thread-composer"][data-composer-kind="reply"]',
    );
    await expect(replyComposer).toBeVisible();
    await replyComposer.getByRole("textbox", { name: "Reply" }).fill(replyMessage);
    await replyComposer.getByRole("button", { name: "Send" }).click();
    await expect(replyComposer).toHaveCount(0);

    await expect(threadRoot).toContainText(rootMessage);
    await expect(threadRoot).toContainText(replyMessage);
    await expect(threadRoot.locator("[data-comment-id]")).toHaveCount(2);
    await expect(threadRoot.locator("section").filter({ hasText: rootMessage })).toHaveCount(1);
    await expect(threadRoot.locator("section").filter({ hasText: replyMessage })).toHaveCount(1);
  });
});
