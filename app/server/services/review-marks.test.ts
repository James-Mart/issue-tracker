import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import type { Server } from "http";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Review, ReviewView } from "../schemas/review.js";

const AT = "2026-07-09T14:00:00.000Z";

let issuesDir: string;
let repo: string;
let server: Server;
let baseUrl: string;
let reviewId: string;
let firstSha: string;

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

function blob(sha: string, path: string): string {
  return git(["rev-parse", `${sha}:${path}`]).trim();
}

function writeIssue(id: string, body: Record<string, unknown>): void {
  mkdirSync(join(issuesDir, id), { recursive: true });
  writeFileSync(join(issuesDir, id, "issue.json"), JSON.stringify({ id, ...body }));
}

function seedHistory(): void {
  repo = mkdtempSync(join(tmpdir(), "issue-tracker-review-marks-repo-"));
  git(["init", "-b", "main"]);
  mkdirSync(join(repo, "src"));
  writeFileSync(join(repo, "src", "base.txt"), "base\n");
  git(["add", "src/base.txt"]);
  git(["commit", "-m", "base"]);
  git(["checkout", "-q", "-b", "story"]);
  git(["rm", "src/base.txt"]);
  mkdirSync(join(repo, "src"));
  writeFileSync(join(repo, "src", "keep.txt"), "keep\n");
  writeFileSync(join(repo, "src", "touch.txt"), "one\n");
  git(["add", "src/keep.txt", "src/touch.txt"]);
  git(["commit", "-m", "Review files"]);
  firstSha = git(["rev-parse", "HEAD"]).trim();
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
}

function readStored(): Review {
  return JSON.parse(
    readFileSync(join(issuesDir, "p", "reviews", `${reviewId}.json`), "utf8"),
  ) as Review;
}

function putMark(body: {
  scope: string;
  path: string;
  reviewed: boolean;
}): Promise<Response> {
  return fetch(`${baseUrl}/api/projects/p/reviews/${reviewId}/marks`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
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
  reviewId = ((await created.json()) as ReviewView).id;
}

describe("review marks", () => {
  beforeEach(async () => {
    issuesDir = mkdtempSync(join(tmpdir(), "issue-tracker-review-marks-"));
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

  it("drops a whole-review mark from progress when a later commit changes that file", async () => {
    for (const path of ["src/base.txt", "src/keep.txt", "src/touch.txt"]) {
      const marked = await putMark({ scope: "all", path, reviewed: true });
      expect(marked.status).toBe(200);
    }
    const commitMarked = await putMark({
      scope: firstSha,
      path: "src/touch.txt",
      reviewed: true,
    });
    expect(commitMarked.status).toBe(200);
    const touchBlob = blob(firstSha, "src/touch.txt");

    writeFileSync(join(repo, "src", "touch.txt"), "two\n");
    git(["add", "src/touch.txt"]);
    git(["commit", "-m", "Touch again"]);
    const secondSha = git(["rev-parse", "HEAD"]).trim();
    writeIssue("t2", {
      kind: "task",
      title: "Second",
      partOf: "s",
      commits: [secondSha],
      order: 1,
      createdAt: AT,
      updatedAt: AT,
    });

    const res = await fetch(`${baseUrl}/api/projects/p/reviews/${reviewId}`);
    expect(res.status).toBe(200);
    const progress = ((await res.json()) as ReviewView).progress;
    expect(progress.all).toEqual({
      reviewed: 2,
      total: 3,
      changedSinceReviewed: ["src/touch.txt"],
    });
    expect(progress.commits[firstSha]).toEqual({ reviewed: 1, total: 3 });
    expect(progress.commits[secondSha]).toEqual({ reviewed: 0, total: 1 });

    const stored = readStored();
    expect(stored.marks.all["src/touch.txt"]?.blobSha).toBe(touchBlob);
    expect(stored.marks.all["src/touch.txt"]?.blobSha).not.toBe(blob(secondSha, "src/touch.txt"));
    expect(stored.marks.all["src/keep.txt"]?.blobSha).toBe(blob(secondSha, "src/keep.txt"));
    expect(stored.marks.all["src/base.txt"]?.blobSha).toBe("");
    expect(stored.marks.commits[firstSha]?.["src/touch.txt"]).toEqual({
      markedAt: expect.any(String),
    });
  });
});
