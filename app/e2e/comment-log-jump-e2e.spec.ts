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
  const workspace = mkdtempSync(join(tmpdir(), "it-e2e-comment-log-jump-ws-"));
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

type CommentLogJumpApp = {
  baseURL: string;
  taskId: string;
  threadId: string;
  rootMessage: string;
};

const test = base.extend<
  Record<string, never>,
  { commentLogJumpApp: CommentLogJumpApp }
>({
  commentLogJumpApp: [
    async ({}, use) => {
      const fixture = seedFixtureRepo();
      const rootMessage = "E2E anchored review on INDIA rename";

      let taskId = "";
      let threadId = "";

      const app = await bootSeededApp({
        afterApply: async ({ update, create }) => {
          await update("seed-proj", { workspace: fixture.workspace });

          const story = await create({
            kind: "story",
            title: "Comment log jump story",
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

          const { appendComment } = await import("../server/services/issues.js");
          const anchored = await appendComment(task.id, {
            role: "code-quality-validator",
            body: rootMessage,
            anchor: {
              path: "names.txt",
              side: "new",
              line: 4,
              commitSha: fixture.namesSha,
            },
          });
          threadId = anchored.id;
        },
      });

      await use({
        baseURL: app.baseURL,
        taskId,
        threadId,
        rootMessage,
      });

      await app.stop();
      rmSync(fixture.workspace, { recursive: true, force: true });
    },
    { scope: "worker" },
  ],
});

async function gotoOverview(
  page: Page,
  baseURL: string,
  issueId: string,
): Promise<Locator> {
  await page.goto(`${baseURL}/projects/seed-proj/issues/${issueId}`);
  const main = page.getByRole("main");
  await expect(main.getByRole("tab", { name: "Overview" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  return main;
}

function commentsRegion(main: Locator): Locator {
  return main.locator('[data-region="comments"]');
}

test.describe("Comment log jump e2e", () => {
  test("shows the anchored snippet and jumps to the inline thread on Diff", async ({
    page,
    commentLogJumpApp,
  }) => {
    const { baseURL, taskId, threadId, rootMessage } = commentLogJumpApp;

    const main = await gotoOverview(page, baseURL, taskId);
    const comments = commentsRegion(main);
    await expect(comments).toBeVisible();

    const logThread = comments.locator(`[data-thread-root="${threadId}"]`);
    await expect(logThread).toBeVisible();
    await expect(logThread).toContainText(rootMessage);

    const snippet = logThread.getByTestId("comment-anchor-snippet");
    await expect(snippet).toBeVisible();
    const anchoredLine = snippet.locator('[data-snippet-line="4"][data-anchored]');
    await expect(anchoredLine).toBeVisible();
    await expect(anchoredLine).toContainText("INDIA", { exact: true });
    await expect(snippet.getByText("charlie", { exact: true })).toBeVisible();

    await logThread.getByRole("button", { name: "See this comment in the diff" }).click();

    await expect(page).toHaveURL(
      new RegExp(`[?&]tab=diff(?:&|$).*thread=${threadId}|thread=${threadId}.*[?&]tab=diff`),
    );
    await expect(main.getByRole("tab", { name: "Diff" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    const file = main.getByTestId("issue-change-file-diff");
    await expect(file).toHaveAttribute("data-file-name", "names.txt");
    const inlineThread = file.locator(`[data-thread-root="${threadId}"]`);
    await expect(inlineThread).toBeVisible();
    await expect(inlineThread).toContainText(rootMessage);
    await expect(inlineThread).toBeInViewport();
  });
});
