import { ChildProcess, type ChildProcessByStdio } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough, type Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { refreshStorePathsFromEnv } from "../config.js";
import { setGhSpawnerForTests, type GhSpawner } from "./delivery.js";
import {
  fetchPrComments,
  mirrorConversationComments,
  resetPrCommentMirrorForTests,
} from "./pr-comment-mirror.js";
import type { PrSyncStepResult } from "./pr-sync-driver.js";

const AT = "2026-07-09T14:00:00.000Z";
const PR_URL = "https://github.com/acme/widgets/pull/7";
const WORKSPACE = "/repo/root";

let dir: string;
let ghCalls: string[][] = [];

function writeIssue(id: string, body: Record<string, unknown>): void {
  mkdirSync(join(dir, id), { recursive: true });
  writeFileSync(join(dir, id, "issue.json"), JSON.stringify({ id, ...body }));
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

function stubGh(pages: string[]): void {
  let index = 0;
  const spawner: GhSpawner = (_command, args) => {
    ghCalls.push(args);
    const stdout = pages[index] ?? pages[pages.length - 1] ?? "";
    index += 1;
    return mockChild({ stdout });
  };
  setGhSpawnerForTests(spawner);
}

function queryOf(args: string[]): string {
  return args.find((arg) => arg.startsWith("query="))?.slice("query=".length) ?? "";
}

function commentNode(overrides: Record<string, unknown> = {}) {
  return {
    id: "IC_1",
    url: "https://github.com/acme/widgets/pull/7#issuecomment-1",
    body: "ship it",
    createdAt: "2024-03-01T12:00:00Z",
    updatedAt: "2024-03-01T12:00:00Z",
    author: { __typename: "User", login: "ada" },
    ...overrides,
  };
}

function page(nodes: unknown[], hasNextPage = false, endCursor: string | null = null) {
  return JSON.stringify({
    data: {
      repository: {
        pullRequest: {
          comments: {
            pageInfo: { hasNextPage, endCursor },
            nodes,
          },
        },
      },
    },
  });
}

function previous(matches: Map<string, string> = new Map()): PrSyncStepResult {
  return { matches, facts: new Map() } as PrSyncStepResult;
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

function story(id: string): void {
  writeIssue(id, {
    kind: "story",
    title: id,
    partOf: "p",
    order: 0,
    merged: false,
    createdAt: AT,
    updatedAt: AT,
  });
}

function storedLines(id: string): Record<string, unknown>[] {
  const path = join(dir, id, "comments.jsonl");
  try {
    return readFileSync(path, "utf8")
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  } catch {
    return [];
  }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pr-comment-mirror-"));
  vi.stubEnv("ISSUES_DIR", dir);
  refreshStorePathsFromEnv();
  ghCalls = [];
  resetPrCommentMirrorForTests();
});

afterEach(() => {
  setGhSpawnerForTests(null);
  resetPrCommentMirrorForTests();
  vi.unstubAllEnvs();
  refreshStorePathsFromEnv();
  rmSync(dir, { recursive: true, force: true });
});

describe("fetchPrComments", () => {
  it("pages full history in created order and leaves edits empty", async () => {
    stubGh([
      page(
        [commentNode({ id: "IC_2", createdAt: "2024-04-01T00:00:00Z", body: "later" })],
        true,
        "cursor-1",
      ),
      page([
        commentNode({ id: "IC_1", createdAt: "2024-03-01T00:00:00Z", body: "earlier" }),
        commentNode({
          id: "IC_bot",
          body: "rebased",
          createdAt: "2024-05-01T00:00:00Z",
          author: { __typename: "Bot", login: "dependabot[bot]" },
          updatedAt: "2024-05-01T00:00:00Z",
        }),
        commentNode({ id: "IC_gone", author: null, body: "deleted user" }),
        commentNode({ id: "IC_blank", body: "" }),
        commentNode({
          id: "IC_org",
          author: { __typename: "Organization", login: "acme" },
        }),
      ]),
    ]);

    const result = await fetchPrComments(PR_URL, undefined, WORKSPACE);

    expect(ghCalls).toHaveLength(2);
    expect(queryOf(ghCalls[0]!)).toContain("CREATED_AT");
    expect(queryOf(ghCalls[0]!)).not.toContain("UPDATED_AT");
    expect(queryOf(ghCalls[1]!)).toContain('after: "cursor-1"');
    expect(result.edits).toEqual([]);
    expect(result.comments.map((comment) => comment.source.id)).toEqual([
      "IC_1",
      "IC_2",
      "IC_bot",
    ]);
    expect(result.comments[0]).toMatchObject({
      role: "human",
      name: "ada",
      body: "earlier",
      createdAt: "2024-03-01T00:00:00.000Z",
      source: {
        kind: "github",
        id: "IC_1",
        url: "https://github.com/acme/widgets/pull/7#issuecomment-1",
      },
    });
    expect(result.comments[2]).toMatchObject({
      role: "github-bot",
      name: "dependabot[bot]",
    });
    expect(result.comments.every((comment) => comment.replyToSourceId === undefined)).toBe(
      true,
    );
  });

  it("stops an incremental fetch once comments are older than since", async () => {
    stubGh([
      page(
        [
          commentNode({
            id: "IC_new",
            updatedAt: "2026-08-02T00:00:00Z",
            createdAt: "2026-08-02T00:00:00Z",
          }),
          commentNode({
            id: "IC_old",
            updatedAt: "2026-07-01T00:00:00Z",
            createdAt: "2026-07-01T00:00:00Z",
          }),
        ],
        true,
        "cursor-2",
      ),
      page([commentNode({ id: "IC_should_not_fetch" })]),
    ]);

    const result = await fetchPrComments(
      PR_URL,
      "2026-08-01T00:00:00.000Z",
      WORKSPACE,
    );

    expect(ghCalls).toHaveLength(1);
    expect(queryOf(ghCalls[0]!)).toContain("UPDATED_AT");
    expect(result.comments.map((comment) => comment.source.id)).toEqual(["IC_new"]);
    expect(result.edits).toEqual([]);
  });

  it("includes a comment updated at the since boundary", async () => {
    stubGh([
      page([
        commentNode({
          id: "IC_edge",
          updatedAt: "2026-08-01T00:00:00Z",
          createdAt: "2026-07-01T00:00:00Z",
        }),
      ]),
    ]);

    const result = await fetchPrComments(
      PR_URL,
      "2026-08-01T00:00:00.000Z",
      WORKSPACE,
    );
    expect(result.comments.map((comment) => comment.source.id)).toEqual(["IC_edge"]);
  });

  it("fails loudly when the pull request is missing", async () => {
    stubGh([JSON.stringify({ data: { repository: { pullRequest: null } } })]);
    await expect(fetchPrComments(PR_URL, undefined, WORKSPACE)).rejects.toMatchObject({
      code: "gh-failed",
      message: "gh graphql returned no pull request",
    });
  });

  it("refuses a URL that is not a GitHub pull request", async () => {
    await expect(
      fetchPrComments("https://example.com/acme/widgets/pull/7", undefined, WORKSPACE),
    ).rejects.toMatchObject({
      code: "not-github-pr-url",
    });
    expect(ghCalls).toHaveLength(0);
  });
});

describe("mirrorConversationComments", () => {
  it("makes no GitHub call when reconcile matched nothing", async () => {
    const input = previous();
    const result = await mirrorConversationComments("p", input);
    expect(ghCalls).toHaveLength(0);
    expect(result).toBe(input);
  });

  it("lands human conversation comments and skips ones already mirrored", async () => {
    project();
    story("ship");
    writeFileSync(
      join(dir, "ship", "comments.jsonl"),
      `${JSON.stringify({
        id: "already",
        role: "human",
        name: "ada",
        body: "old",
        at: "2024-01-01T00:00:00.000Z",
        source: {
          kind: "github",
          id: "IC_old",
          url: "https://github.com/acme/widgets/pull/7#issuecomment-old",
        },
      })}\n`,
    );
    stubGh([
      page([
        commentNode({
          id: "IC_old",
          body: "old",
          url: "https://github.com/acme/widgets/pull/7#issuecomment-old",
          createdAt: "2024-01-01T00:00:00Z",
        }),
        commentNode({
          id: "IC_new",
          body: "please rename this",
          url: "https://github.com/acme/widgets/pull/7#issuecomment-new",
          createdAt: "2024-06-01T00:00:00Z",
        }),
        commentNode({
          id: "IC_bot",
          body: "coverage dropped",
          author: { __typename: "Bot", login: "github-actions[bot]" },
          createdAt: "2024-06-02T00:00:00Z",
        }),
      ]),
    ]);

    const facts = new Map();
    const result = await mirrorConversationComments("p", {
      matches: new Map([["ship", PR_URL]]),
      facts,
    } as PrSyncStepResult);

    expect(result.error).toBeUndefined();
    expect(result.facts).toBe(facts);
    const lines = storedLines("ship");
    expect(lines.map((line) => line.id)).toEqual(["already", expect.any(String)]);
    expect(lines[1]).toMatchObject({
      role: "human",
      name: "ada",
      body: "please rename this",
      at: "2024-06-01T00:00:00.000Z",
      source: {
        kind: "github",
        id: "IC_new",
        url: "https://github.com/acme/widgets/pull/7#issuecomment-new",
      },
    });
    expect(lines[1]).not.toHaveProperty("createdAt");
    expect(lines[1]).not.toHaveProperty("replyToSourceId");
    expect(lines.some((line) => line.role === "github-bot")).toBe(false);
  });

  it("fetches the full history once per process, then only comments updated since", async () => {
    project();
    story("ship");
    stubGh([
      page([commentNode()]),
      page([commentNode({ updatedAt: "2099-01-01T00:00:00Z" })]),
    ]);
    const input = {
      matches: new Map([["ship", PR_URL]]),
      facts: new Map(),
    } as PrSyncStepResult;

    await mirrorConversationComments("p", input);
    await mirrorConversationComments("p", input);

    expect(queryOf(ghCalls[0]!)).toContain("CREATED_AT");
    expect(queryOf(ghCalls[1]!)).toContain("UPDATED_AT");
    expect(storedLines("ship")).toHaveLength(1);
  });

  it("does not advance the cursor when the read fails, and names the story", async () => {
    project();
    story("ship");
    story("other");
    const spawner: GhSpawner = (_command, args) => {
      ghCalls.push(args);
      return mockChild({ code: 1, stderr: "gh exploded" });
    };
    setGhSpawnerForTests(spawner);
    const input = {
      matches: new Map<string, string>([
        ["ship", PR_URL],
        ["other", "https://github.com/acme/widgets/pull/8"],
      ]),
      facts: new Map([["ship", { url: PR_URL }]]),
    } as PrSyncStepResult;

    const failed = await mirrorConversationComments("p", input);
    expect(failed.error).toBe("ship: gh exploded");
    expect(failed.facts).toBe(input.facts);
    expect(storedLines("ship")).toHaveLength(0);
    expect(ghCalls).toHaveLength(1);

    stubGh([page([commentNode()])]);
    const retried = await mirrorConversationComments("p", input);
    expect(retried.error).toBeUndefined();
    expect(queryOf(ghCalls[1]!)).toContain("CREATED_AT");
    expect(storedLines("ship")).toHaveLength(1);
  });
});
