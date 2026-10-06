import { execFileSync, spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import type { Server } from "http";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReviewCommits, ReviewDiff } from "../schemas/review.js";

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

  it("lists story commits oldest first", async () => {
    const res = await fetch(`${baseUrl}/api/projects/p/reviews/${reviewId}/commits`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as ReviewCommits;
    expect(body.mergeBase).toBe("main");
    expect(body.mergeBaseRef).toBe("main");
    expect(body.tip).toBe(tip);
    expect(body.commits.map((commit) => commit.sha)).toEqual([firstSha, secondSha]);
    expect(body.commits.map((commit) => commit.subject)).toEqual([
      "Add beta",
      "Rename and add",
    ]);
    expect(body.commits[0]).toMatchObject({
      author: "Tester",
      authoredAt: git(["show", "-s", "--format=%aI", firstSha]).trim(),
      files: 1,
      additions: 1,
      deletions: 0,
    });
    expect(body.commits[1]).toMatchObject({
      author: "Tester",
      files: 2,
      additions: 1,
      deletions: 0,
    });
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

  it("returns one commit against its parent", async () => {
    const res = await fetch(
      `${baseUrl}/api/projects/p/reviews/${reviewId}/diff?scope=${firstSha}`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as ReviewDiff;
    const parent = git(["rev-parse", `${firstSha}^`]).trim();
    expect(body.scope).toBe(firstSha);
    expect(body.patch).toBe(git(["diff", `${parent}..${firstSha}`]));
    expect(body.files).toEqual([
      {
        path: "src/a.txt",
        status: "modified",
        additions: 1,
        deletions: 0,
        blobSha: git(["rev-parse", `${firstSha}:src/a.txt`]).trim(),
        tooLarge: false,
      },
    ]);
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

  it("uses an empty blobSha when the commit deletes a file", async () => {
    git(["rm", "src/c.txt"]);
    git(["commit", "-m", "Drop c"]);
    const sha = git(["rev-parse", "HEAD"]).trim();
    writeIssue("t3", {
      kind: "task",
      title: "Drop",
      partOf: "s",
      commits: [sha],
      order: 2,
      createdAt: AT,
      updatedAt: AT,
    });

    const res = await fetch(
      `${baseUrl}/api/projects/p/reviews/${reviewId}/diff?scope=${sha}`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as ReviewDiff;
    expect(body.files).toEqual([
      {
        path: "src/c.txt",
        status: "deleted",
        additions: 0,
        deletions: 1,
        blobSha: "",
        tooLarge: false,
      },
    ]);
  });

  it("omits a file whose patch exceeds the ceiling", async () => {
    writeFileSync(join(repo, "src", "tiny.txt"), "ok\n");
    writeFileSync(join(repo, "src", "huge.txt"), `${"x".repeat(4000)}\n`);
    git(["add", "src/tiny.txt", "src/huge.txt"]);
    git(["commit", "-m", "Huge"]);
    const hugeSha = git(["rev-parse", "HEAD"]).trim();
    writeIssue("t3", {
      kind: "task",
      title: "Huge",
      partOf: "s",
      commits: [hugeSha],
      order: 2,
      createdAt: AT,
      updatedAt: AT,
    });
    vi.stubEnv("ISSUE_TRACKER_MAX_PATCH_BYTES", "500");

    const res = await fetch(
      `${baseUrl}/api/projects/p/reviews/${reviewId}/diff?scope=${hugeSha}`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as ReviewDiff;
    const huge = body.files.find((file) => file.path === "src/huge.txt");
    const tiny = body.files.find((file) => file.path === "src/tiny.txt");
    expect(huge).toMatchObject({ tooLarge: true, status: "added" });
    expect(tiny).toMatchObject({ tooLarge: false, status: "added" });
    expect(body.patch).not.toContain("diff --git a/src/huge.txt");
    expect(body.patch).toContain("diff --git a/src/tiny.txt");
  });

  it("reuses the mark index raw diff when the diff endpoint loads the same ranges", async () => {
    const { setGitSpawnerForTests } = await import("./git-read.js");
    const { clearRawDiffCacheForTests } = await import("./review-diff.js");
    clearRawDiffCacheForTests();
    const commands: string[][] = [];
    setGitSpawnerForTests((command, args, options) => {
      commands.push(args);
      return spawn(command, args, {
        cwd: options.cwd,
        env: options.env,
        stdio: options.stdio ?? ["ignore", "pipe", "pipe"],
      }) as ChildProcessByStdio<Writable | null, Readable, Readable>;
    });
    const rawCount = () => commands.filter((args) => args.includes("--raw")).length;
    try {
      const indexed = await fetch(`${baseUrl}/api/projects/p/reviews/${reviewId}`);
      expect(indexed.status).toBe(200);
      const rawAfterIndex = rawCount();
      expect(rawAfterIndex).toBeGreaterThan(0);

      const allRes = await fetch(
        `${baseUrl}/api/projects/p/reviews/${reviewId}/diff?scope=all`,
      );
      const commitRes = await fetch(
        `${baseUrl}/api/projects/p/reviews/${reviewId}/diff?scope=${firstSha}`,
      );
      expect(allRes.status).toBe(200);
      expect(commitRes.status).toBe(200);
      const allBody = (await allRes.json()) as ReviewDiff;
      const commitBody = (await commitRes.json()) as ReviewDiff;
      expect(allBody.files.length).toBeGreaterThan(0);
      expect(commitBody.files).toEqual([
        {
          path: "src/a.txt",
          status: "modified",
          additions: 1,
          deletions: 0,
          blobSha: git(["rev-parse", `${firstSha}:src/a.txt`]).trim(),
          tooLarge: false,
        },
      ]);
      expect(commands.some((args) => args[0] === "diff" && !args.includes("--raw"))).toBe(
        true,
      );
      expect(rawCount()).toBe(rawAfterIndex);
    } finally {
      setGitSpawnerForTests(null);
    }
  });
});
