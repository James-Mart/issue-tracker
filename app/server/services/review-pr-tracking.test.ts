import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { refreshStorePathsFromEnv } from "../config.js";
import { setGhSpawnerForTests, type GhSpawner } from "./delivery.js";
import { setGitSpawnerForTests } from "./git-read.js";
import { setGitWriteSpawnerForTests } from "./git-write.js";
import { mockChild } from "./pr-comment-mirror-harness.js";
import { trackReviewPullRequests } from "./review-pr-tracking.js";

const AT = "2026-07-09T14:00:00.000Z";
const PR_URL = "https://github.com/acme/widgets/pull/7";
const HEAD = "abc";

let dir: string;

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
    baseRefName: "main",
    updatedAt: "2026-08-01T00:00:00Z",
    comments: { totalCount: 0, nodes: [] },
    commits: { nodes: [{ commit: { statusCheckRollup: null } }] },
  };
}

function graphql(state: "OPEN" | "CLOSED" | "MERGED", headRefOid: string): string {
  return JSON.stringify({
    data: { repository: { pr_7: pullNode(state, headRefOid) } },
  });
}

function stubGh(stdout: string): void {
  const spawner: GhSpawner = () => mockChild({ stdout });
  setGhSpawnerForTests(spawner);
}

describe("trackReviewPullRequests", () => {
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "review-pr-tracking-"));
    vi.stubEnv("ISSUES_DIR", dir);
    vi.stubEnv("ISSUE_TRACKER_STORE_READ_ONLY", "");
    vi.stubEnv("ISSUE_TRACKER_GUEST", "");
    refreshStorePathsFromEnv();
    setGitSpawnerForTests(null);
    setGitWriteSpawnerForTests(null);
    writeIssue("p", {
      kind: "project",
      title: "P",
      workspace: dir,
      order: 0,
      createdAt: AT,
      updatedAt: AT,
    });
  });

  afterEach(() => {
    setGhSpawnerForTests(null);
    vi.unstubAllEnvs();
    refreshStorePathsFromEnv();
    rmSync(dir, { recursive: true, force: true });
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
      pr: prSource(HEAD),
    });
    stubGh(graphql("MERGED", HEAD));
    await trackReviewPullRequests("p", { matches: new Map(), facts: new Map() });
    expect(readStored("rev")).toMatchObject({
      archived: true,
      pr: prSource(HEAD, "merged"),
    });

    const { reopenReview } = await import("./reviews.js");
    await reopenReview("p", "rev");
    stubGh(graphql("MERGED", HEAD));
    await trackReviewPullRequests("p", { matches: new Map(), facts: new Map() });
    expect(readStored("rev").archived).toBe(false);

    stubGh(graphql("CLOSED", HEAD));
    await trackReviewPullRequests("p", { matches: new Map(), facts: new Map() });
    expect(readStored("rev")).toMatchObject({
      archived: true,
      pr: prSource(HEAD, "closed"),
    });
  });
});
