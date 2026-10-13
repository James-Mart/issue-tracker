import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { forceRemoveWorktree } from "../worktree-test-cleanup.js";

const AT = "2026-07-09T14:00:00.000Z";

let root: string;
let dir: string;
let repo: string;
let tip: string;

const gitEnv = {
  ...process.env,
  GIT_AUTHOR_NAME: "Tester",
  GIT_AUTHOR_EMAIL: "tester@example.com",
  GIT_COMMITTER_NAME: "Tester",
  GIT_COMMITTER_EMAIL: "tester@example.com",
};

function git(args: string[], cwd = repo): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", env: gitEnv }).trim();
}

function writeIssue(id: string, body: Record<string, unknown>): void {
  mkdirSync(join(dir, id), { recursive: true });
  writeFileSync(join(dir, id, "issue.json"), JSON.stringify({ id, ...body }));
}

function readStored(id: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(dir, id, "issue.json"), "utf8")) as Record<
    string,
    unknown
  >;
}

function seedRepo(): void {
  repo = mkdtempSync(join(tmpdir(), "review-worktree-repo-"));
  git(["init", "-b", "main"]);
  writeFileSync(join(repo, "file.txt"), "base\n");
  git(["add", "file.txt"]);
  git(["commit", "-m", "base"]);
  git(["checkout", "-q", "-b", "story"]);
  writeFileSync(join(repo, "file.txt"), "changed\n");
  git(["add", "file.txt"]);
  git(["commit", "-m", "change"]);
  tip = git(["rev-parse", "HEAD"]);
}

function seedProject(): void {
  writeIssue("p", {
    kind: "project",
    title: "P",
    workspace: repo,
    order: 0,
    createdAt: AT,
    updatedAt: AT,
  });
  writeIssue("e", {
    kind: "epic",
    title: "E",
    partOf: "p",
    order: 0,
    createdAt: AT,
    updatedAt: AT,
  });
  writeIssue("s", {
    kind: "story",
    title: "S",
    partOf: "e",
    order: 0,
    merged: false,
    createdAt: AT,
    updatedAt: AT,
  });
  writeIssue("t", {
    kind: "task",
    title: "T",
    partOf: "s",
    commits: [tip],
    order: 0,
    createdAt: AT,
    updatedAt: AT,
  });
}

function dropProjectWorktrees(): void {
  if (!repo) return;
  forceRemoveWorktree(repo, "p", "s-review");
}

async function load() {
  vi.resetModules();
  vi.stubEnv("ISSUES_DIR", dir);
  vi.stubEnv("ISSUE_TRACKER_STORE_READ_ONLY", "");
  vi.stubEnv("ISSUE_TRACKER_GUEST", "");
  const config = await import("../config.js");
  config.refreshStorePathsFromEnv();
  const reviews = await import("./reviews.js");
  const issues = await import("./issues.js");
  const worktrees = await import("./review-worktree.js");
  return { ...reviews, ...issues, ...worktrees };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "review-worktree-"));
  dir = join(root, "issues");
  mkdirSync(dir);
  seedRepo();
});

afterEach(() => {
  dropProjectWorktrees();
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
  rmSync(repo, { recursive: true, force: true });
});

describe("review worktree lifecycle", () => {
  it("removes the checkout on archive and recreates it at the current tip on reopen", async () => {
    seedProject();
    const { openOrCreateReview, archiveReview, reopenReview, update } = await load();
    const opened = await openOrCreateReview("p", { story: "s" });
    const first = opened.review.worktreePath!;

    writeFileSync(join(repo, "file.txt"), "again\n");
    git(["add", "file.txt"]);
    git(["commit", "-m", "again"]);
    const next = git(["rev-parse", "HEAD"]);
    await update("t", { commits: [tip, next] });

    await archiveReview("p", opened.review.id);
    expect(existsSync(first)).toBe(false);
    expect(readStored(opened.review.id).worktreePath).toBeUndefined();

    const reopened = await reopenReview("p", opened.review.id);
    const second = reopened.worktreePath!;
    expect(existsSync(second)).toBe(true);
    expect(git(["rev-parse", "HEAD"], second)).toBe(next);
    expect(git(["rev-parse", "--abbrev-ref", "HEAD"], second)).toBe("HEAD");
  });
});
