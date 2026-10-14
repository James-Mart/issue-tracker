import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { refreshStorePathsFromEnv } from "../config.js";
import { setGhSpawnerForTests, type GhSpawner } from "./delivery.js";
import { setGitSpawnerForTests } from "./git-read.js";
import { setGitWriteSpawnerForTests } from "./git-write.js";
import { mockChild } from "./pr-comment-mirror-harness.js";
import { forceRemoveWorktree } from "../worktree-test-cleanup.js";
import { trackReviewPullRequests } from "./review-pr-tracking.js";

const AT = "2026-07-09T14:00:00.000Z";
const PR_URL = "https://github.com/acme/widgets/pull/7";

let dir: string;
let repo: string;
let head: string;

function git(cwd: string, args: string[]): string {
  return execFileSync(
    "git",
    ["-c", "user.name=test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", ...args],
    { cwd, encoding: "utf8" },
  ).trim();
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

function prSource(headSha: string, state?: "open" | "closed" | "merged") {
  return {
    url: PR_URL,
    number: 7,
    baseRef: "main",
    headRef: "pr-head",
    headSha,
    fork: false,
    ...(state ? { state } : {}),
  };
}

function pullNode(
  state: "OPEN" | "CLOSED" | "MERGED",
  headRefOid: string,
  baseRefName = "main",
): Record<string, unknown> {
  return {
    number: 7,
    url: PR_URL,
    state,
    isDraft: false,
    mergeable: "UNKNOWN",
    mergeStateStatus: "UNKNOWN",
    reviewDecision: null,
    headRefOid,
    baseRefName,
    updatedAt: "2026-08-01T00:00:00Z",
    comments: { totalCount: 0, nodes: [] },
    commits: { nodes: [{ commit: { statusCheckRollup: null } }] },
  };
}

function graphql(
  state: "OPEN" | "CLOSED" | "MERGED",
  headRefOid: string,
  baseRefName = "main",
): string {
  return JSON.stringify({
    data: { repository: { pr_7: pullNode(state, headRefOid, baseRefName) } },
  });
}

const fetches: string[][] = [];

function installFetchRecorder(): void {
  fetches.length = 0;
  setGitWriteSpawnerForTests((command, args, options) => {
    if (args[0] === "fetch") fetches.push(args);
    return spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
  });
}

function stubGh(stdout: string): void {
  const spawner: GhSpawner = () => mockChild({ stdout });
  setGhSpawnerForTests(spawner);
}

describe("trackReviewPullRequests", () => {
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "review-pr-tracking-"));
    repo = mkdtempSync(join(tmpdir(), "review-pr-tracking-repo-"));
    git(repo, ["init", "-b", "main"]);
    writeFileSync(join(repo, "file.txt"), "one\n");
    git(repo, ["add", "file.txt"]);
    git(repo, ["commit", "-m", "base"]);
    head = git(repo, ["rev-parse", "HEAD"]);
    vi.stubEnv("ISSUES_DIR", dir);
    vi.stubEnv("ISSUE_TRACKER_STORE_READ_ONLY", "");
    vi.stubEnv("ISSUE_TRACKER_GUEST", "");
    refreshStorePathsFromEnv();
    setGitSpawnerForTests(null);
    setGitWriteSpawnerForTests(null);
    writeIssue("p", {
      kind: "project",
      title: "P",
      workspace: repo,
      order: 0,
      createdAt: AT,
      updatedAt: AT,
    });
  });

  afterEach(() => {
    if (repo) forceRemoveWorktree(repo, "p", "rev");
    setGhSpawnerForTests(null);
    setGitWriteSpawnerForTests(null);
    vi.unstubAllEnvs();
    refreshStorePathsFromEnv();
    rmSync(dir, { recursive: true, force: true });
    if (repo) rmSync(repo, { recursive: true, force: true });
  });

  it("fetches origin/<baseRef> on sync when head and base name are unchanged", async () => {
    const bare = mkdtempSync(join(tmpdir(), "review-pr-tracking-bare-"));
    git(bare, ["init", "--bare", "-b", "main"]);
    git(repo, ["remote", "add", "origin", bare]);
    git(repo, ["push", "-u", "origin", "main"]);
    installFetchRecorder();
    writeIssue("rev", {
      kind: "review",
      title: "External change",
      partOf: "p",
      archived: false,
      marks: { all: {}, commits: {} },
      submissions: [],
      order: 0,
      createdAt: AT,
      updatedAt: AT,
      pr: prSource(head),
    });
    stubGh(graphql("OPEN", head));
    await trackReviewPullRequests("p", { matches: new Map(), facts: new Map() });
    expect(readStored("rev")).toMatchObject({ pr: prSource(head) });
    expect(fetches).toEqual([["fetch", "origin", "main"]]);
    rmSync(bare, { recursive: true, force: true });
  });

  it("stores a base retarget and fetches origin/<new base> on sync", async () => {
    const bare = mkdtempSync(join(tmpdir(), "review-pr-tracking-bare-"));
    git(bare, ["init", "--bare", "-b", "main"]);
    git(repo, ["remote", "add", "origin", bare]);
    git(repo, ["push", "-u", "origin", "main"]);
    git(repo, ["checkout", "-b", "develop"]);
    writeFileSync(join(repo, "develop.txt"), "on develop\n");
    git(repo, ["add", "develop.txt"]);
    git(repo, ["commit", "-m", "develop tip"]);
    git(repo, ["push", "origin", "develop"]);
    git(repo, ["checkout", "main"]);
    installFetchRecorder();
    writeIssue("rev", {
      kind: "review",
      title: "External change",
      partOf: "p",
      archived: false,
      marks: { all: {}, commits: {} },
      submissions: [],
      order: 0,
      createdAt: AT,
      updatedAt: AT,
      pr: prSource(head),
    });
    stubGh(graphql("OPEN", head, "develop"));
    await trackReviewPullRequests("p", { matches: new Map(), facts: new Map() });
    expect(readStored("rev")).toMatchObject({
      pr: { ...prSource(head), baseRef: "develop" },
    });
    expect(fetches).toEqual([["fetch", "origin", "develop"]]);
    rmSync(bare, { recursive: true, force: true });
  });

  it("archives a PR-only review when the pull request is merged or closed", async () => {
    writeIssue("rev", {
      kind: "review",
      title: "External change",
      partOf: "p",
      archived: false,
      marks: { all: {}, commits: {} },
      submissions: [],
      order: 0,
      createdAt: AT,
      updatedAt: AT,
      pr: prSource(head),
    });
    stubGh(graphql("MERGED", head));
    await trackReviewPullRequests("p", { matches: new Map(), facts: new Map() });
    expect(readStored("rev")).toMatchObject({
      archived: true,
      pr: prSource(head, "merged"),
    });

    const { reopenReview } = await import("./reviews.js");
    await reopenReview("p", "rev");
    stubGh(graphql("MERGED", head));
    await trackReviewPullRequests("p", { matches: new Map(), facts: new Map() });
    expect(readStored("rev").archived).toBe(false);

    stubGh(graphql("CLOSED", head));
    await trackReviewPullRequests("p", { matches: new Map(), facts: new Map() });
    expect(readStored("rev")).toMatchObject({
      archived: true,
      pr: prSource(head, "closed"),
    });
  });
});
