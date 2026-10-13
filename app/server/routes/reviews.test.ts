import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import type { Server } from "http";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { forceRemoveWorktree } from "../worktree-test-cleanup.js";

const AT = "2026-07-09T14:00:00.000Z";

let dir: string;
let repo: string;
let commitSha: string;
let server: Server;
let baseUrl: string;

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

function initRepo(): void {
  repo = mkdtempSync(join(tmpdir(), "issue-tracker-reviews-repo-"));
  git(["init", "-b", "main"]);
  writeFileSync(join(repo, "file.txt"), "base\n");
  git(["add", "file.txt"]);
  git(["commit", "-m", "base"]);
  git(["checkout", "-q", "-b", "story"]);
  writeFileSync(join(repo, "file.txt"), "changed\n");
  git(["add", "file.txt"]);
  git(["commit", "-m", "change"]);
  commitSha = git(["rev-parse", "HEAD"]).trim();
}

function writeIssue(id: string, body: Record<string, unknown>): void {
  mkdirSync(join(dir, id), { recursive: true });
  writeFileSync(join(dir, id, "issue.json"), JSON.stringify({ id, ...body }));
}

function seedProjectTree(): void {
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
  writeIssue("t", {
    kind: "task",
    title: "T",
    partOf: "s",
    commits: [commitSha],
    order: 0,
    createdAt: AT,
    updatedAt: AT,
  });
}

async function bootReviewsRoute(
  options: { readOnly?: boolean; seed?: () => void } = {},
): Promise<void> {
  dir = mkdtempSync(join(tmpdir(), "issue-tracker-reviews-"));
  initRepo();
  vi.resetModules();
  vi.stubEnv("ISSUES_DIR", dir);
  vi.stubEnv("ISSUE_TRACKER_STORE_READ_ONLY", options.readOnly ? "1" : "");
  seedProjectTree();
  options.seed?.();

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

async function teardownReviewsRoute(): Promise<void> {
  if (repo) forceRemoveWorktree(repo, "p", "s-review");
  vi.unstubAllEnvs();
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
  rmSync(dir, { recursive: true, force: true });
  rmSync(repo, { recursive: true, force: true });
}

afterEach(teardownReviewsRoute);

function openReview(projectId: string, storyId: string): Promise<Response> {
  return fetch(`${baseUrl}/api/projects/${projectId}/reviews`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ story: storyId }),
  });
}

type ReviewBody = {
  id: string;
  kind: string;
  partOf: string;
  story: string;
  archived: boolean;
  status: string;
  archivedReason?: string;
  createdAt: string;
  updatedAt: string;
};

function readStoredReview(id: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(dir, id, "issue.json"), "utf8")) as Record<
    string,
    unknown
  >;
}

async function fetchReview(id: string): Promise<ReviewBody> {
  const res = await fetch(`${baseUrl}/api/projects/p/reviews/${id}`);
  expect(res.status).toBe(200);
  return (await res.json()) as ReviewBody;
}

describe("review record API", () => {
  beforeEach(() => bootReviewsRoute());

  it("stores a started review as a review issue and returns it on a second open-or-create", async () => {
    const created = await openReview("p", "s");
    expect(created.status).toBe(201);
    const first = (await created.json()) as ReviewBody;
    expect(first).toMatchObject({
      id: "s-review",
      kind: "review",
      partOf: "p",
      story: "s",
      archived: false,
      status: "open",
    });
    expect(first.archivedReason).toBeUndefined();

    const again = await openReview("p", "s");
    expect(again.status).toBe(200);
    const second = (await again.json()) as ReviewBody;
    expect(second.id).toBe(first.id);
    expect(second.createdAt).toBe(first.createdAt);
    expect(second.updatedAt).toBe(first.updatedAt);

    const stored = readStoredReview(first.id);
    expect(stored).toMatchObject({
      kind: "review",
      story: "s",
      archived: false,
      marks: { all: {}, commits: {} },
      submissions: [],
    });
    expect(stored.status).toBeUndefined();
    expect(existsSync(join(dir, "p", "reviews"))).toBe(false);
  });

  it("archives the review when its Story merges, and a reopen keeps it open", async () => {
    const review = (await (await openReview("p", "s")).json()) as ReviewBody;
    const { update } = await import("../services/issues.js");
    await update("s", { merged: true });

    expect(readStoredReview(review.id).archived).toBe(true);
    expect(await fetchReview(review.id)).toMatchObject({
      status: "archived",
      archivedReason: "merged",
    });

    const reopened = await fetch(
      `${baseUrl}/api/projects/p/reviews/${review.id}/reopen`,
      { method: "POST" },
    );
    expect(reopened.status).toBe(200);
    expect(await reopened.json()).toMatchObject({ status: "open", archived: false });

    await update("s", { title: "S renamed" });
    expect((await fetchReview(review.id)).status).toBe("open");
  });
});

describe("review record API read-only", () => {
  const reviewId = "11111111-1111-4111-8111-111111111111";

  beforeEach(() =>
    bootReviewsRoute({
      readOnly: true,
      seed: () =>
        writeIssue(reviewId, {
          kind: "review",
          title: "S",
          partOf: "p",
          story: "s",
          archived: false,
          marks: { all: {}, commits: {} },
          submissions: [],
          order: 0,
          createdAt: AT,
          updatedAt: AT,
        }),
    }),
  );

  it("refuses review writes and still reads the stored review", async () => {
    const before = readFileSync(join(dir, reviewId, "issue.json"), "utf8");

    const created = await openReview("p", "s");
    expect(created.status).toBe(403);
    expect(await created.json()).toMatchObject({ code: "read_only" });

    const archived = await fetch(
      `${baseUrl}/api/projects/p/reviews/${reviewId}/archive`,
      { method: "POST" },
    );
    expect(archived.status).toBe(403);
    expect(await archived.json()).toMatchObject({ code: "read_only" });

    const reopened = await fetch(
      `${baseUrl}/api/projects/p/reviews/${reviewId}/reopen`,
      { method: "POST" },
    );
    expect(reopened.status).toBe(403);
    expect(await reopened.json()).toMatchObject({ code: "read_only" });

    const marked = await fetch(`${baseUrl}/api/projects/p/reviews/${reviewId}/marks`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope: "all", path: "file.txt", reviewed: true }),
    });
    expect(marked.status).toBe(403);
    expect(await marked.json()).toMatchObject({ code: "read_only" });

    expect(readFileSync(join(dir, reviewId, "issue.json"), "utf8")).toBe(before);

    const read = await fetch(`${baseUrl}/api/projects/p/reviews/${reviewId}`);
    expect(read.status).toBe(200);
    expect(await read.json()).toMatchObject({ id: reviewId, status: "open" });
  });
});
