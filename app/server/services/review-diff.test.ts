import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import type { Server } from "http";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReviewDiff } from "../schemas/review.js";

const AT = "2026-07-09T14:00:00.000Z";

let issuesDir: string;
let repo: string;
let server: Server;
let baseUrl: string;
let reviewId: string;
let firstSha: string;
let secondSha: string;
let foreignSha: string;
let tip: string;

const gitEnv = {
  ...process.env,
  GIT_AUTHOR_NAME: "Tester",
  GIT_AUTHOR_EMAIL: "tester@example.com",
  GIT_COMMITTER_NAME: "Tester",
  GIT_COMMITTER_EMAIL: "tester@example.com",
};

function git(args: string[], cwd = repo): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", env: gitEnv });
}

function writeIssue(id: string, body: Record<string, unknown>): void {
  mkdirSync(join(issuesDir, id), { recursive: true });
  writeFileSync(join(issuesDir, id, "issue.json"), JSON.stringify({ id, ...body }));
}

function seedHistory(): void {
  repo = mkdtempSync(join(tmpdir(), "issue-tracker-review-diff-repo-"));
  git(["init", "-b", "main"]);
  mkdirSync(join(repo, "src"));
  writeFileSync(join(repo, "src", "a.txt"), "alpha\n");
  git(["add", "src/a.txt"]);
  git(["commit", "-m", "base"]);
  git(["checkout", "-q", "-b", "story"]);
  writeFileSync(join(repo, "src", "a.txt"), "alpha\nbeta\n");
  git(["add", "src/a.txt"]);
  git(["commit", "-m", "Add beta"]);
  firstSha = git(["rev-parse", "HEAD"]).trim();
  git(["mv", "src/a.txt", "src/b.txt"]);
  writeFileSync(join(repo, "src", "c.txt"), "see\n");
  git(["add", "src/c.txt"]);
  git(["commit", "-m", "Rename and add"]);
  secondSha = git(["rev-parse", "HEAD"]).trim();
  tip = secondSha;
  git(["checkout", "-q", "main"]);
  git(["checkout", "-q", "-b", "foreign"]);
  writeFileSync(join(repo, "foreign.txt"), "nope\n");
  git(["add", "foreign.txt"]);
  git(["commit", "-m", "Foreign"]);
  foreignSha = git(["rev-parse", "HEAD"]).trim();
  git(["checkout", "-q", "story"]);
}

function seedIssues(): void {
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
    createdAt: AT,
    updatedAt: AT,
  });
  writeIssue("t1", {
    kind: "task",
    title: "First",
    partOf: "s",
    commits: [firstSha],
    order: 0,
    createdAt: AT,
    updatedAt: AT,
  });
  writeIssue("t2", {
    kind: "task",
    title: "Second",
    partOf: "s",
    commits: [secondSha],
    order: 1,
    createdAt: AT,
    updatedAt: AT,
  });
}

async function listen(): Promise<void> {
  const { createApp } = await import("../app.js");
  const app = createApp();
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address();
  if (!addr || typeof addr === "string") {
    throw new Error("expected TCP listen address");
  }
  baseUrl = `http://127.0.0.1:${addr.port}`;
}

async function closeServer(): Promise<void> {
  if (!server) return;
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

async function openReview(): Promise<void> {
  const created = await fetch(`${baseUrl}/api/projects/p/reviews`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ target: { kind: "story", storyId: "s" } }),
  });
  expect(created.status).toBe(201);
  const body = (await created.json()) as { id: string };
  reviewId = body.id;
}

describe("review diff API", () => {
  beforeEach(async () => {
    issuesDir = mkdtempSync(join(tmpdir(), "issue-tracker-review-diff-"));
    vi.resetModules();
    vi.stubEnv("ISSUES_DIR", issuesDir);
    vi.stubEnv("ISSUE_TRACKER_STORE_READ_ONLY", "");
    seedHistory();
    seedIssues();
    await listen();
    await openReview();
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await closeServer();
    rmSync(issuesDir, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  });

  it("returns the story change range for scope=all, including post-image blob shas", async () => {
    const { readIssueChange } = await import("./change.js");
    const storyChange = await readIssueChange("s");
    expect(storyChange.state).toBe("loaded");
    if (storyChange.state !== "loaded") return;

    const res = await fetch(
      `${baseUrl}/api/projects/p/reviews/${reviewId}/diff?scope=all`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as ReviewDiff;
    expect(body.scope).toBe("all");
    expect(body.patch).toBe(storyChange.patch);
    expect(body.patch).toBe(git(["diff", `main...${tip}`]));

    const renamed = body.files.find((file) => file.path === "src/b.txt");
    const added = body.files.find((file) => file.path === "src/c.txt");
    expect(renamed).toMatchObject({
      oldPath: "src/a.txt",
      status: "renamed",
      tooLarge: false,
      blobSha: git(["rev-parse", `${tip}:src/b.txt`]).trim(),
    });
    expect(added).toMatchObject({
      status: "added",
      tooLarge: false,
      blobSha: git(["rev-parse", `${tip}:src/c.txt`]).trim(),
    });
    expect(added?.oldPath).toBeUndefined();
  });

  it("refuses a sha that is not one of the story commits", async () => {
    const res = await fetch(
      `${baseUrl}/api/projects/p/reviews/${reviewId}/diff?scope=${foreignSha}`,
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      code: "validation",
      error: `sha "${foreignSha}" is not one of this story's commits`,
    });
  });
});
