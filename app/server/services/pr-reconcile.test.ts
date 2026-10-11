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
    if (opts.stdout) child.stdout.emit("data", opts.stdout);
    if (opts.stderr) child.stderr.emit("data", opts.stderr);
    child.emit("close", opts.code ?? 0);
  });
  return child;
}

function stubOrigin(url: string): void {
  const spawner: GitSpawner = () => mockChild({ stdout: `${url}\n` });
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

function project(): void {
  writeIssue("p", {
    kind: "project",
    title: "P",
    workspace: WORKSPACE,
    order: 0,
    createdAt: AT,
    updatedAt: AT,
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
});

describe("reconcileProjectPrs failures", () => {
  it("returns an auth failure and writes nothing", async () => {
    project();
    story("ship", { branchName: "feat/ship" });
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
});
