import { ChildProcess, type ChildProcessByStdio } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough, type Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { refreshStorePathsFromEnv } from "../config.js";
import { setGhSpawnerForTests, type GhSpawner } from "./delivery.js";
import { setGitSpawnerForTests, type GitSpawner } from "./git-read.js";
import { reconcileProjectPrs } from "./pr-reconcile.js";

const AT = "2026-07-09T14:00:00.000Z";
const WORKSPACE = "/repo/root";
const ORIGIN = "git@github.com:acme/widgets.git";
const OPEN_URL = "https://github.com/acme/widgets/pull/7";
const CLOSED_URL = "https://github.com/acme/widgets/pull/3";
const MERGED_AT = "2026-08-01T09:30:00Z";

let dir: string;
let gitCalls: string[][] = [];
let ghCalls: string[][] = [];

function writeIssue(id: string, body: Record<string, unknown>): void {
  mkdirSync(join(dir, id), { recursive: true });
  writeFileSync(join(dir, id, "issue.json"), JSON.stringify({ id, ...body }));
}

function readStoryJson(id: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(dir, id, "issue.json"), "utf8")) as Record<
    string,
    unknown
  >;
}

function mockChild(opts: {
  code?: number | null;
  stdout?: string;
  stderr?: string;
  error?: NodeJS.ErrnoException;
}): ChildProcessByStdio<null, Readable, Readable> {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const child = Object.assign(new ChildProcess(), {
    stdin: null,
    stdout,
    stderr,
    stdio: [null, stdout, stderr, undefined, undefined] as const,
  });
  setImmediate(() => {
    if (opts.error) {
      child.emit("error", opts.error);
      return;
    }
    if (opts.stdout) child.stdout.emit("data", opts.stdout);
    if (opts.stderr) child.stderr.emit("data", opts.stderr);
    child.emit("close", opts.code ?? 0);
  });
  return child;
}

function stubOrigin(url: string | null): void {
  const spawner: GitSpawner = (_command, args) => {
    gitCalls.push(args);
    if (url === null) {
      return mockChild({ code: 2, stderr: "fatal: No such remote 'origin'" });
    }
    return mockChild({ stdout: `${url}\n` });
  };
  setGitSpawnerForTests(spawner);
}

function stubGh(
  handler: (args: string[]) => ReturnType<typeof mockChild>,
): void {
  const spawner: GhSpawner = (_command, args) => {
    ghCalls.push(args);
    return handler(args);
  };
  setGhSpawnerForTests(spawner);
}

function queryOf(args: string[]): string {
  return args.find((arg) => arg.startsWith("query="))?.slice("query=".length) ?? "";
}

function ghPullRequest(overrides: Record<string, unknown> = {}) {
  return {
    number: 7,
    url: OPEN_URL,
    state: "OPEN",
    isDraft: false,
    mergeable: "MERGEABLE",
    mergeStateStatus: "CLEAN",
    reviewDecision: null,
    headRefOid: "abc123",
    baseRefName: "main",
    updatedAt: "2026-08-01T00:00:00Z",
    mergedAt: null,
    comments: { totalCount: 0, nodes: [] },
    commits: {
      nodes: [
        {
          commit: {
            statusCheckRollup: {
              state: "SUCCESS",
              contexts: {
                totalCount: 0,
                checkRunCountsByState: [],
                statusContextCountsByState: [],
              },
            },
          },
        },
      ],
    },
    ...overrides,
  };
}

function graphql(repository: Record<string, unknown>) {
  return mockChild({
    stdout: JSON.stringify({ data: { repository } }),
  });
}

function project(extra: Record<string, unknown> = {}): void {
  writeIssue("p", {
    kind: "project",
    title: "P",
    workspace: WORKSPACE,
    order: 0,
    createdAt: AT,
    updatedAt: AT,
    ...extra,
  });
}

function story(id: string, extra: Record<string, unknown> = {}): void {
  writeIssue(id, {
    kind: "story",
    title: id,
    partOf: "p",
    order: 0,
    merged: false,
    createdAt: AT,
    updatedAt: AT,
    ...extra,
  });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pr-reconcile-"));
  vi.stubEnv("ISSUES_DIR", dir);
  refreshStorePathsFromEnv();
  gitCalls = [];
  ghCalls = [];
  stubOrigin(ORIGIN);
});

afterEach(() => {
  setGhSpawnerForTests(null);
  setGitSpawnerForTests(null);
  vi.unstubAllEnvs();
  refreshStorePathsFromEnv();
  rmSync(dir, { recursive: true, force: true });
});

describe("reconcileProjectPrs candidates", () => {
  it("makes no GitHub call when nothing is eligible", async () => {
    project();
    story("no-branch");
    story("archived", { branchName: "feat/archived", archived: true });
    story("old-merge", {
      branchName: "feat/old",
      merged: true,
      mergedAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString(),
    });
    story("merged-no-stamp", { branchName: "feat/unstamped", merged: true });
    story("no-base", { branchName: "feat/child", stackedOn: "no-branch" });
    writeIssue("q", {
      kind: "project",
      title: "Q",
      workspace: "/other",
      order: 1,
      createdAt: AT,
      updatedAt: AT,
    });
    story("elsewhere", { partOf: "q", branchName: "feat/elsewhere" });
    stubGh(() => graphql({}));

    const result = await reconcileProjectPrs("p");

    expect(result).toEqual({
      checked: 0,
      writes: [],
      matches: new Map(),
      facts: new Map(),
    });
    expect(ghCalls).toHaveLength(0);
    expect(gitCalls).toHaveLength(0);
  });

  it("checks a fast-forward story and a recently merged story", async () => {
    project();
    story("ff", { branchName: "feat/ff", mergePolicy: "fast-forward", order: 0 });
    story("recent", {
      order: 1,
      branchName: "feat/recent",
      merged: true,
      mergedAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      prUrl: "https://github.com/acme/widgets/pull/8",
    });
    stubGh(() =>
      graphql({
        c_0_live: {
          nodes: [ghPullRequest({ number: 4, url: "https://github.com/acme/widgets/pull/4" })],
        },
        c_0_closed: { nodes: [] },
        c_1_live: {
          nodes: [
            ghPullRequest({
              number: 8,
              url: "https://github.com/acme/widgets/pull/8",
              state: "MERGED",
              mergedAt: MERGED_AT,
            }),
          ],
        },
        c_1_closed: { nodes: [] },
      }),
    );

    const result = await reconcileProjectPrs("p");

    expect(result.checked).toBe(2);
    expect(ghCalls).toHaveLength(1);
    expect(result.error).toBeUndefined();
    expect(result.matches.get("ff")).toBe("https://github.com/acme/widgets/pull/4");
    expect(result.matches.get("recent")).toBe("https://github.com/acme/widgets/pull/8");
    expect(result.facts.get("recent")?.state).toBe("merged");
    expect(result.writes.map((write) => write.storyId)).toEqual(["ff"]);
  });

  it("uses the derived merge base, including a stacked story on a merged parent", async () => {
    project();
    story("parent", {
      branchName: "feat/parent",
      merged: true,
      mergedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
    });
    story("child", { branchName: "feat/child", stackedOn: "parent", order: 1 });
    let query = "";
    stubGh((args) => {
      query = queryOf(args);
      return graphql({
        c_0_live: { nodes: [ghPullRequest()] },
        c_0_closed: { nodes: [] },
      });
    });

    const result = await reconcileProjectPrs("p");

    expect(result.checked).toBe(1);
    expect(query).toContain('headRefName: "feat/child"');
    expect(query).toContain('baseRefName: "main"');
    expect(query).not.toContain("feat/parent");
    expect(gitCalls).toEqual([["remote", "get-url", "origin"]]);
  });

  it("queries the bare branch when the merge base override names origin/", async () => {
    project();
    story("ship", { branchName: "feat/ship", mergeBaseOverride: "origin/main" });
    let query = "";
    stubGh((args) => {
      query = queryOf(args);
      return graphql({
        c_0_live: { nodes: [ghPullRequest()] },
        c_0_closed: { nodes: [] },
      });
    });

    const result = await reconcileProjectPrs("p");

    expect(query).toContain('baseRefName: "main"');
    expect(query).not.toContain("origin/main");
    expect(result.matches.get("ship")).toBeDefined();
  });
});

describe("reconcileProjectPrs outcomes", () => {
  it("sets prUrl from an open PR and prefers it over a newer closed PR", async () => {
    project();
    story("ship", { branchName: "feat/ship" });
    let query = "";
    stubGh((args) => {
      query = queryOf(args);
      return graphql({
        c_0_live: {
          nodes: [
            ghPullRequest({ updatedAt: "2026-08-01T00:00:00Z", number: 7, url: OPEN_URL }),
          ],
        },
        c_0_closed: {
          nodes: [
            ghPullRequest({
              number: 3,
              url: CLOSED_URL,
              state: "CLOSED",
              updatedAt: "2026-08-02T00:00:00Z",
            }),
          ],
        },
      });
    });

    const result = await reconcileProjectPrs("p");

    expect(query).toContain('owner: "acme"');
    expect(query).toContain('name: "widgets"');
    expect(query).toContain("states: [OPEN, MERGED]");
    expect(query).toContain("states: [CLOSED]");
    expect(query).toContain("mergedAt");
    expect(ghCalls).toHaveLength(1);
    expect(result.writes).toEqual([
      { storyId: "ship", fields: { prUrl: OPEN_URL } },
    ]);
    expect(result.matches.get("ship")).toBe(OPEN_URL);
    expect(result.facts.get("ship")).toMatchObject({ state: "open", url: OPEN_URL });
    expect(readStoryJson("ship").prUrl).toBe(OPEN_URL);
    expect(readStoryJson("ship").needsAttention).not.toBe(true);
  });

  it("keeps the newer of two open pull requests", async () => {
    project();
    story("ship", { branchName: "feat/ship" });
    stubGh(() =>
      graphql({
        c_0_live: {
          nodes: [
            ghPullRequest({
              number: 1,
              url: "https://github.com/acme/widgets/pull/1",
              updatedAt: "2026-08-01T00:00:00Z",
            }),
            ghPullRequest({
              number: 9,
              url: "https://github.com/acme/widgets/pull/9",
              updatedAt: "2026-08-03T00:00:00Z",
            }),
          ],
        },
        c_0_closed: { nodes: [] },
      }),
    );

    const result = await reconcileProjectPrs("p");

    expect(result.matches.get("ship")).toBe("https://github.com/acme/widgets/pull/9");
  });

  it("replaces a different prUrl", async () => {
    project();
    story("ship", {
      branchName: "feat/ship",
      prUrl: "https://github.com/acme/widgets/pull/1",
    });
    stubGh(() =>
      graphql({
        c_0_live: { nodes: [ghPullRequest()] },
        c_0_closed: { nodes: [] },
      }),
    );

    const result = await reconcileProjectPrs("p");

    expect(result.writes).toEqual([{ storyId: "ship", fields: { prUrl: OPEN_URL } }]);
  });

  it("marks merged from GitHub, names unfinished tasks, and cascades needsRebase", async () => {
    project();
    story("ship", { branchName: "feat/ship" });
    story("sibling", { branchName: "feat/sibling", order: 1 });
    story("idle", { order: 2 });
    writeIssue("later", {
      kind: "task",
      title: "Later",
      partOf: "ship",
      status: "in-progress",
      order: 2,
      createdAt: AT,
      updatedAt: AT,
    });
    writeIssue("done-task", {
      kind: "task",
      title: "Done",
      partOf: "ship",
      status: "done",
      order: 1,
      createdAt: AT,
      updatedAt: AT,
    });
    writeIssue("first", {
      kind: "task",
      title: "First",
      partOf: "ship",
      status: "todo",
      order: 0,
      createdAt: AT,
      updatedAt: AT,
    });
    stubGh(() =>
      graphql({
        c_0_live: {
          nodes: [
            ghPullRequest({
              state: "MERGED",
              mergedAt: MERGED_AT,
              url: OPEN_URL,
              updatedAt: "2026-08-01T00:00:00Z",
            }),
          ],
        },
        c_0_closed: {
          nodes: [
            ghPullRequest({
              number: 3,
              url: CLOSED_URL,
              state: "CLOSED",
              updatedAt: "2026-08-03T00:00:00Z",
            }),
          ],
        },
        c_1_live: { nodes: [] },
        c_1_closed: { nodes: [] },
      }),
    );

    const result = await reconcileProjectPrs("p");

    expect(result.writes).toEqual([
      {
        storyId: "ship",
        fields: {
          prUrl: OPEN_URL,
          merged: true,
          mergedAt: MERGED_AT,
          needsAttention: true,
          attentionReason: "Tasks not done: first, later",
        },
      },
    ]);
    expect(readStoryJson("ship").merged).toBe(true);
    expect(readStoryJson("ship").mergedAt).toBe(MERGED_AT);
    expect(readStoryJson("sibling").needsRebase).toBe("main");
    expect(readStoryJson("idle").needsRebase).toBeUndefined();
  });

  it("does not flag attention when every task is done", async () => {
    project();
    story("ship", { branchName: "feat/ship", needsAttention: true, attentionReason: "human note" });
    writeIssue("done-task", {
      kind: "task",
      title: "Done",
      partOf: "ship",
      status: "done",
      order: 0,
      createdAt: AT,
      updatedAt: AT,
    });
    stubGh(() =>
      graphql({
        c_0_live: {
          nodes: [ghPullRequest({ state: "MERGED", mergedAt: MERGED_AT })],
        },
        c_0_closed: { nodes: [] },
      }),
    );

    const result = await reconcileProjectPrs("p");

    expect(result.writes).toEqual([
      { storyId: "ship", fields: { prUrl: OPEN_URL, merged: true, mergedAt: MERGED_AT } },
    ]);
    expect(readStoryJson("ship").attentionReason).toBe("human note");
  });

  it("flags a closed pull request without setting merged", async () => {
    project();
    story("ship", { branchName: "feat/ship", needsAttention: true, attentionReason: "human note" });
    stubGh(() =>
      graphql({
        c_0_live: { nodes: [] },
        c_0_closed: {
          nodes: [ghPullRequest({ number: 3, url: CLOSED_URL, state: "CLOSED" })],
        },
      }),
    );

    const result = await reconcileProjectPrs("p");

    expect(result.writes).toEqual([
      {
        storyId: "ship",
        fields: {
          prUrl: CLOSED_URL,
          needsAttention: true,
          attentionReason: `Closed pull request ${CLOSED_URL}`,
        },
      },
    ]);
    expect(readStoryJson("ship").merged).toBe(false);
    expect(readStoryJson("ship").mergedAt).toBeUndefined();
  });

  it("writes nothing when the same remote state is reconciled again", async () => {
    project();
    story("ship", { branchName: "feat/ship" });
    writeIssue("first", {
      kind: "task",
      title: "First",
      partOf: "ship",
      status: "todo",
      order: 0,
      createdAt: AT,
      updatedAt: AT,
    });
    const mergedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    stubGh(() =>
      graphql({
        c_0_live: {
          nodes: [ghPullRequest({ state: "MERGED", mergedAt })],
        },
        c_0_closed: { nodes: [] },
      }),
    );

    const first = await reconcileProjectPrs("p");
    const updatedAt = readStoryJson("ship").updatedAt;
    ghCalls = [];
    const second = await reconcileProjectPrs("p");

    expect(first.writes).toHaveLength(1);
    expect(second.checked).toBe(1);
    expect(second.writes).toEqual([]);
    expect(second.matches.get("ship")).toBe(OPEN_URL);
    expect(second.facts.get("ship")?.state).toBe("merged");
    expect(ghCalls).toHaveLength(1);
    expect(readStoryJson("ship").updatedAt).toBe(updatedAt);
    expect(readStoryJson("ship").mergedAt).toBe(mergedAt);
  });

  it("leaves a story with no matching pull request unchanged", async () => {
    project();
    story("ship", { branchName: "feat/ship" });
    stubGh(() => graphql({ c_0_live: { nodes: [] }, c_0_closed: { nodes: [] } }));

    const result = await reconcileProjectPrs("p");

    expect(result.checked).toBe(1);
    expect(result.writes).toEqual([]);
    expect(result.matches.size).toBe(0);
    expect(result.facts.size).toBe(0);
    expect(result.error).toBeUndefined();
    expect(readStoryJson("ship").prUrl).toBeUndefined();
  });
});

describe("reconcileProjectPrs failures", () => {
  function ship(): void {
    project();
    story("ship", { branchName: "feat/ship" });
  }

  it("returns an auth failure and writes nothing", async () => {
    ship();
    stubGh(() =>
      mockChild({
        code: 4,
        stderr: "To use GitHub CLI in non-interactive mode, set the GH_TOKEN environment variable.",
      }),
    );

    const result = await reconcileProjectPrs("p");

    expect(result.error).toMatch(/GH_TOKEN/);
    expect(result.writes).toEqual([]);
    expect(result.matches.size).toBe(0);
    expect(readStoryJson("ship").prUrl).toBeUndefined();
  });

  it("returns a rate limit and writes nothing", async () => {
    ship();
    stubGh(() => mockChild({ code: 1, stderr: "API rate limit exceeded" }));

    await expect(reconcileProjectPrs("p")).resolves.toMatchObject({
      checked: 1,
      writes: [],
      error: "API rate limit exceeded",
    });
    expect(readStoryJson("ship").prUrl).toBeUndefined();
  });

  it("returns a network failure and writes nothing", async () => {
    ship();
    stubGh(() => mockChild({ code: 1, stderr: "connect ETIMEDOUT" }));

    await expect(reconcileProjectPrs("p")).resolves.toMatchObject({
      error: "connect ETIMEDOUT",
      writes: [],
    });
  });

  it("returns an error when gh is missing", async () => {
    ship();
    stubGh(() =>
      mockChild({
        error: Object.assign(new Error("spawn gh ENOENT"), { code: "ENOENT" }),
      }),
    );

    await expect(reconcileProjectPrs("p")).resolves.toMatchObject({
      error: "gh binary not found",
      writes: [],
    });
  });

  it("returns an error when the repository is missing", async () => {
    ship();
    stubGh(() => mockChild({ stdout: JSON.stringify({ data: { repository: null } }) }));

    await expect(reconcileProjectPrs("p")).resolves.toMatchObject({
      error: "gh graphql returned no repository",
      writes: [],
    });
    expect(readStoryJson("ship").prUrl).toBeUndefined();
  });

  it("returns an error when a pull request connection is missing", async () => {
    ship();
    stubGh(() => graphql({}));

    await expect(reconcileProjectPrs("p")).resolves.toMatchObject({
      error: "gh graphql returned an unexpected pull request",
      writes: [],
    });
    expect(readStoryJson("ship").prUrl).toBeUndefined();
  });

  it("returns an error when a pull request payload is unusable", async () => {
    ship();
    stubGh(() =>
      graphql({
        c_0_live: { nodes: [{ number: 1 }] },
        c_0_closed: { nodes: [] },
      }),
    );

    await expect(reconcileProjectPrs("p")).resolves.toMatchObject({
      error: "gh graphql returned an unexpected pull request",
      writes: [],
    });
    expect(readStoryJson("ship").prUrl).toBeUndefined();
  });

  it("returns an error when origin is missing and does not call gh", async () => {
    ship();
    stubOrigin(null);
    stubGh(() => graphql({}));

    const result = await reconcileProjectPrs("p");

    expect(result.error).toBe("Project workspace has no origin remote");
    expect(result.writes).toEqual([]);
    expect(ghCalls).toHaveLength(0);
  });

  it("returns an error when origin is not GitHub", async () => {
    ship();
    stubOrigin("git@gitlab.com:acme/widgets.git");
    stubGh(() => graphql({}));

    const result = await reconcileProjectPrs("p");

    expect(result.error).toBe(
      "origin is not a GitHub repository: git@gitlab.com:acme/widgets.git",
    );
    expect(ghCalls).toHaveLength(0);
  });

  it("returns an error when the project workspace is unset", async () => {
    project({ workspace: undefined });
    story("ship", { branchName: "feat/ship" });
    stubGh(() => graphql({}));

    const result = await reconcileProjectPrs("p");

    expect(result.error).toBe("Project workspace is not set");
    expect(ghCalls).toHaveLength(0);
    expect(gitCalls).toHaveLength(0);
  });

  it("reads owner and repo from an https origin", async () => {
    ship();
    stubOrigin("https://github.com/acme/widgets.git");
    let query = "";
    stubGh((args) => {
      query = queryOf(args);
      return graphql({ c_0_live: { nodes: [] }, c_0_closed: { nodes: [] } });
    });

    const result = await reconcileProjectPrs("p");

    expect(result.error).toBeUndefined();
    expect(query).toContain('owner: "acme"');
    expect(query).toContain('name: "widgets"');
  });

  it("throws when the id is not a project", async () => {
    project();
    story("ship", { branchName: "feat/ship" });

    await expect(reconcileProjectPrs("missing")).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(reconcileProjectPrs("ship")).rejects.toMatchObject({
      code: "not_found",
    });
  });
});
