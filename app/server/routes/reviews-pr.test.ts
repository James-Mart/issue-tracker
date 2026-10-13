import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GhSpawner } from "../services/delivery.js";
import type { GitSpawner } from "../services/git-read.js";
import { mockChild } from "../services/pr-comment-mirror-harness.js";

const AT = "2026-07-09T14:00:00.000Z";
const ORIGIN_REPO = "acme/widgets";
const PR_URL = "https://github.com/acme/widgets/pull/7";

let dir: string;
let bare: string;
let repo: string;
let headSha: string;
let server: Server;
let baseUrl: string;
let setGhSpawnerForTests: (next: GhSpawner | null) => void;
let setGitSpawnerForTests: (next: GitSpawner | null) => void;
const gitEnv = {
  ...process.env,
  GIT_AUTHOR_NAME: "Tester",
  GIT_AUTHOR_EMAIL: "tester@example.com",
  GIT_COMMITTER_NAME: "Tester",
  GIT_COMMITTER_EMAIL: "tester@example.com",
};

function git(args: string[], cwd?: string): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: gitEnv,
  }).trim();
}

function prViewJson(): string {
  return JSON.stringify({
    number: 7,
    url: PR_URL,
    title: "External change",
    baseRefName: "main",
    headRefName: "pr-head",
    headRefOid: headSha,
    isCrossRepository: false,
  });
}

function writeIssue(id: string, body: Record<string, unknown>): void {
  mkdirSync(join(dir, id), { recursive: true });
  writeFileSync(join(dir, id, "issue.json"), JSON.stringify({ id, ...body }));
}

function seedRepo(): void {
  bare = mkdtempSync(join(tmpdir(), "issue-tracker-pr-bare-"));
  repo = mkdtempSync(join(tmpdir(), "issue-tracker-pr-repo-"));
  git(["init", "--bare", "-b", "main"], bare);
  git(["init", "-b", "main"], repo);
  writeFileSync(join(repo, "file.txt"), "base\n");
  git(["add", "file.txt"], repo);
  git(["commit", "-m", "base"], repo);
  git(["remote", "add", "origin", bare], repo);
  git(["push", "-u", "origin", "main"], repo);
  git(["checkout", "-q", "-b", "pr-head"], repo);
  writeFileSync(join(repo, "file.txt"), "changed\n");
  git(["add", "file.txt"], repo);
  git(["commit", "-m", "External change"], repo);
  headSha = git(["rev-parse", "HEAD"], repo);
  git(["push", "origin", "pr-head"], repo);
  git(["--git-dir", bare, "update-ref", "refs/pull/7/head", headSha]);
  git(["checkout", "-q", "main"], repo);
  writeFileSync(join(repo, "later.txt"), "later\n");
  git(["add", "later.txt"], repo);
  git(["commit", "-m", "main moved"], repo);
  git(["push", "origin", "main"], repo);
}

function seedProject(story: Record<string, unknown> | undefined): void {
  writeIssue("p", {
    kind: "project",
    title: "P",
    workspace: repo,
    order: 0,
    createdAt: AT,
    updatedAt: AT,
  });
  if (!story) return;
  writeIssue("s", {
    kind: "story",
    title: "Ship it",
    partOf: "p",
    order: 0,
    createdAt: AT,
    updatedAt: AT,
    ...story,
  });
}

async function boot(story?: Record<string, unknown>): Promise<void> {
  dir = mkdtempSync(join(tmpdir(), "issue-tracker-pr-reviews-"));
  seedRepo();
  vi.resetModules();
  vi.stubEnv("ISSUES_DIR", dir);
  seedProject(story);
  ({ setGhSpawnerForTests } = await import("../services/delivery.js"));
  ({ setGitSpawnerForTests } = await import("../services/git-read.js"));
  setGitSpawnerForTests((command, args, options) => {
    if (args[0] === "remote" && args[1] === "get-url") {
      return mockChild({ stdout: `https://github.com/${ORIGIN_REPO}.git\n` });
    }
    return spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
  });
  const spawner: GhSpawner = () => mockChild({ stdout: prViewJson() });
  setGhSpawnerForTests(spawner);
  const { createApp } = await import("../app.js");
  const app = createApp();
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("expected TCP listen address");
  baseUrl = `http://127.0.0.1:${addr.port}`;
}

async function teardown(): Promise<void> {
  if (setGhSpawnerForTests) setGhSpawnerForTests(null);
  if (setGitSpawnerForTests) setGitSpawnerForTests(null);
  vi.unstubAllEnvs();
  if (server) {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
  if (dir) rmSync(dir, { recursive: true, force: true });
  if (repo) rmSync(repo, { recursive: true, force: true });
  if (bare) rmSync(bare, { recursive: true, force: true });
}

function postPr(pr: string): Promise<Response> {
  return fetch(`${baseUrl}/api/projects/p/reviews`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pr }),
  });
}

function readStored(id: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(dir, id, "issue.json"), "utf8")) as Record<
    string,
    unknown
  >;
}

describe("POST /api/projects/:projectId/reviews { pr }", () => {
  beforeEach(() => boot());
  afterEach(teardown);

  it("loads a pull request number as a review and serves its range", async () => {
    const created = await postPr("7");
    expect(created.status).toBe(201);
    expect(await created.json()).toEqual({ reviewId: "pr-7-review", created: true });
    expect(git(["rev-parse", "refs/pull/7/head"], repo)).toBe(headSha);

    const stored = readStored("pr-7-review");
    expect(stored).toMatchObject({
      kind: "review",
      title: "External change",
      pr: {
        url: PR_URL,
        number: 7,
        baseRef: "main",
        headRef: "pr-head",
        headSha,
        fork: false,
      },
    });
    expect(stored.story).toBeUndefined();

    const again = await postPr("acme/widgets#7");
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ reviewId: "pr-7-review", created: false });

    const commits = await fetch(`${baseUrl}/api/projects/p/reviews/pr-7-review/commits`);
    expect(commits.status).toBe(200);
    expect(await commits.json()).toMatchObject({
      mergeBase: "main",
      mergeBaseRef: "main",
      tip: headSha,
    });
    const commitBody = (await fetch(
      `${baseUrl}/api/projects/p/reviews/pr-7-review/commits`,
    ).then((res) => res.json())) as { commits: Array<{ sha: string; subject: string }> };
    expect(commitBody.commits.map((commit) => commit.sha)).toEqual([headSha]);
    expect(commitBody.commits[0]?.subject).toBe("External change");

    const diff = await fetch(
      `${baseUrl}/api/projects/p/reviews/pr-7-review/diff?scope=all`,
    );
    expect(diff.status).toBe(200);
    const diffBody = (await diff.json()) as { patch: string };
    expect(diffBody.patch).toContain("file.txt");
    expect(diffBody.patch).toContain("+changed");
  });
});
