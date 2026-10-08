import { ChildProcess, type ChildProcessByStdio } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough, type Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { refreshStorePathsFromEnv } from "../config.js";
import { setGhSpawnerForTests, type GhSpawner } from "./delivery.js";
import { readComments } from "./comment-append.js";
import {
  fetchPrComments,
  mirrorPrComments,
  resetPrCommentMirrorForTests,
} from "./pr-comment-mirror.js";
import type { PrSyncStepResult } from "./pr-sync-driver.js";
import { isSubmittable } from "../../src/features/reviews/lib/review-submittable.js";

const AT = "2026-07-09T14:00:00.000Z";
const PR_URL = "https://github.com/acme/widgets/pull/7";
const WORKSPACE = "/repo/root";
const SHA = "a".repeat(40);
const OLD_SHA = "b".repeat(40);

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

function stubGh(respond: (query: string) => string): void {
  const spawner: GhSpawner = (_command, args) => {
    ghCalls.push(args);
    return mockChild({ stdout: respond(queryOf(args)) });
  };
  setGhSpawnerForTests(spawner);
}

function connectionPage(
  field: string,
  nodes: unknown[],
  hasNextPage = false,
  endCursor: string | null = null,
) {
  return JSON.stringify({
    data: {
      repository: {
        pullRequest: {
          [field]: {
            pageInfo: { hasNextPage, endCursor },
            nodes,
          },
        },
      },
    },
  });
}

/** Conversation pages, with empty review and thread connections. */
function commentPages(pages: string[]): (query: string) => string {
  let index = 0;
  return (query) => {
    if (query.includes("reviewThreads(")) return connectionPage("reviewThreads", []);
    if (query.includes("reviews(")) return connectionPage("reviews", []);
    const stdout = pages[index] ?? pages[pages.length - 1] ?? "";
    index += 1;
    return stdout;
  };
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
  return connectionPage("comments", nodes, hasNextPage, endCursor);
}

function reviewNode(overrides: Record<string, unknown> = {}) {
  return {
    id: "PRR_1",
    url: "https://github.com/acme/widgets/pull/7#pullrequestreview-1",
    body: "Looks good overall",
    state: "COMMENTED",
    submittedAt: "2024-06-03T00:00:00Z",
    updatedAt: "2024-06-03T00:00:00Z",
    author: { __typename: "User", login: "ada" },
    ...overrides,
  };
}

function reviewCommentNode(overrides: Record<string, unknown> = {}) {
  return {
    id: "PRRC_1",
    url: "https://github.com/acme/widgets/pull/7#discussion_r1",
    body: "rename this",
    createdAt: "2024-06-01T00:00:00Z",
    updatedAt: "2024-06-01T00:00:00Z",
    state: "SUBMITTED",
    author: { __typename: "User", login: "ada" },
    commit: { oid: SHA },
    originalCommit: { oid: SHA },
    replyTo: null,
    ...overrides,
  };
}

function threadNode(
  comments: unknown[],
  overrides: Record<string, unknown> = {},
  commentPage: { hasNextPage?: boolean; endCursor?: string | null } = {},
) {
  return {
    id: "PRT_1",
    path: "src/app.ts",
    line: 12,
    originalLine: 12,
    startLine: null,
    originalStartLine: null,
    diffSide: "RIGHT",
    subjectType: "LINE",
    comments: {
      pageInfo: {
        hasNextPage: commentPage.hasNextPage ?? false,
        endCursor: commentPage.endCursor ?? null,
      },
      nodes: comments,
    },
    ...overrides,
  };
}

function githubParts(parts: {
  comments?: unknown[];
  reviews?: unknown[];
  threads?: unknown[];
  threadCommentPages?: Record<string, string>;
}): (query: string) => string {
  return (query) => {
    if (query.includes("node(id:")) {
      const id = /node\(id: "([^"]+)"\)/.exec(query)?.[1] ?? "";
      return (
        parts.threadCommentPages?.[id] ??
        JSON.stringify({
          data: {
            node: {
              comments: {
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: [],
              },
            },
          },
        })
      );
    }
    if (query.includes("reviewThreads(")) {
      return connectionPage("reviewThreads", parts.threads ?? []);
    }
    if (query.includes("reviews(")) return connectionPage("reviews", parts.reviews ?? []);
    return connectionPage("comments", parts.comments ?? []);
  };
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
    stubGh(commentPages([
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
    ]));

    const result = await fetchPrComments(PR_URL, undefined, WORKSPACE);

    expect(ghCalls).toHaveLength(4);
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
    stubGh(commentPages([
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
    ]));

    const result = await fetchPrComments(
      PR_URL,
      "2026-08-01T00:00:00.000Z",
      WORKSPACE,
    );

    expect(ghCalls).toHaveLength(3);
    expect(queryOf(ghCalls[0]!)).toContain("UPDATED_AT");
    expect(result.comments.map((comment) => comment.source.id)).toEqual(["IC_new"]);
    expect(result.edits).toEqual([]);
  });

  it("includes a comment updated at the since boundary", async () => {
    stubGh(commentPages([
      page([
        commentNode({
          id: "IC_edge",
          updatedAt: "2026-08-01T00:00:00Z",
          createdAt: "2026-07-01T00:00:00Z",
        }),
      ]),
    ]));

    const result = await fetchPrComments(
      PR_URL,
      "2026-08-01T00:00:00.000Z",
      WORKSPACE,
    );
    expect(result.comments.map((comment) => comment.source.id)).toEqual(["IC_edge"]);
  });

  it("fails loudly when the pull request is missing", async () => {
    stubGh(() => JSON.stringify({ data: { repository: { pullRequest: null } } }));
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

  it("lands review summaries and skips pending or blank ones", async () => {
    stubGh(
      githubParts({
        reviews: [
          reviewNode(),
          reviewNode({
            id: "PRR_pending",
            state: "PENDING",
            body: "still drafting",
            submittedAt: null,
          }),
          reviewNode({ id: "PRR_blank", body: "" }),
          reviewNode({
            id: "PRR_bot",
            body: "coverage dropped",
            state: "COMMENTED",
            submittedAt: "2024-06-04T00:00:00Z",
            updatedAt: "2024-06-04T00:00:00Z",
            author: { __typename: "Bot", login: "github-actions[bot]" },
          }),
        ],
      }),
    );

    const result = await fetchPrComments(PR_URL, undefined, WORKSPACE);

    expect(result.comments.map((comment) => comment.source.id)).toEqual([
      "PRR_1",
      "PRR_bot",
    ]);
    expect(result.comments[0]).toMatchObject({
      role: "human",
      name: "ada",
      body: "Looks good overall",
      createdAt: "2024-06-03T00:00:00.000Z",
    });
    expect(result.comments[0]?.replyToSourceId).toBeUndefined();
    expect(result.comments[0]?.anchor).toBeUndefined();
    expect(result.comments[1]).toMatchObject({
      role: "github-bot",
      name: "github-actions[bot]",
    });
  });

  it("anchors inline threads and keeps review replies pointed at their parent", async () => {
    const reply = reviewCommentNode({
      id: "PRRC_reply",
      body: "done",
      createdAt: "2024-06-01T01:00:00Z",
      updatedAt: "2024-06-01T01:00:00Z",
      replyTo: { id: "PRRC_1" },
      author: { __typename: "Bot", login: "coderabbit[bot]" },
    });
    stubGh(
      githubParts({
        threads: [
          threadNode(
            [reviewCommentNode(), reply],
            { id: "PRT_line", startLine: 10 },
          ),
          threadNode([reviewCommentNode({ id: "PRRC_left" })], {
            id: "PRT_left",
            diffSide: "LEFT",
            line: 4,
          }),
          threadNode(
            [
              reviewCommentNode({
                id: "PRRC_file",
                author: { __typename: "Bot", login: "dependabot[bot]" },
              }),
            ],
            {
              id: "PRT_file",
              subjectType: "FILE",
              line: null,
              originalLine: null,
              diffSide: "RIGHT",
              path: "README.md",
            },
          ),
          threadNode(
            [
              reviewCommentNode({
                id: "PRRC_old",
                commit: { oid: SHA },
                originalCommit: { oid: OLD_SHA },
              }),
            ],
            {
              id: "PRT_old",
              line: null,
              originalLine: 7,
              startLine: null,
              originalStartLine: 5,
              diffSide: "LEFT",
            },
          ),
          threadNode(
            [reviewCommentNode({ id: "PRRC_pending", state: "PENDING", body: "draft" })],
            { id: "PRT_pending" },
          ),
        ],
      }),
    );

    const result = await fetchPrComments(PR_URL, undefined, WORKSPACE);
    const byId = new Map(result.comments.map((comment) => [comment.source.id, comment]));

    expect(byId.get("PRRC_1")).toMatchObject({
      anchor: { path: "src/app.ts", side: "new", line: 12, startLine: 10, commitSha: SHA },
    });
    expect(byId.get("PRRC_1")?.replyToSourceId).toBeUndefined();
    expect(byId.get("PRRC_reply")).toMatchObject({
      role: "github-bot",
      name: "coderabbit[bot]",
      replyToSourceId: "PRRC_1",
    });
    expect(byId.get("PRRC_reply")?.anchor).toBeUndefined();
    expect(byId.get("PRRC_left")?.anchor).toMatchObject({ side: "old", line: 4 });
    expect(byId.get("PRRC_file")?.anchor).toEqual({ path: "README.md", commitSha: SHA });
    expect(byId.get("PRRC_old")?.anchor).toEqual({
      path: "src/app.ts",
      side: "old",
      line: 7,
      startLine: 5,
      commitSha: OLD_SHA,
    });
    expect(byId.has("PRRC_pending")).toBe(false);
  });

  it("pages review-thread comments past the first page", async () => {
    const reply = reviewCommentNode({
      id: "PRRC_2",
      body: "second page",
      createdAt: "2024-06-02T00:00:00Z",
      replyTo: { id: "PRRC_1" },
    });
    stubGh(
      githubParts({
        threads: [
          threadNode([reviewCommentNode()], { id: "PRT_paged" }, {
            hasNextPage: true,
            endCursor: "thread-cursor",
          }),
        ],
        threadCommentPages: {
          PRT_paged: JSON.stringify({
            data: {
              node: {
                comments: {
                  pageInfo: { hasNextPage: false, endCursor: null },
                  nodes: [reply],
                },
              },
            },
          }),
        },
      }),
    );

    const result = await fetchPrComments(PR_URL, undefined, WORKSPACE);

    expect(ghCalls.map(queryOf).some((query) => query.includes('after: "thread-cursor"'))).toBe(
      true,
    );
    expect(result.comments.map((comment) => comment.source.id)).toEqual([
      "PRRC_1",
      "PRRC_2",
    ]);
    expect(result.comments[1]?.replyToSourceId).toBe("PRRC_1");
  });

  it("keeps review items updated at or after since and still pages the whole connection", async () => {
    stubGh(
      githubParts({
        reviews: [
          reviewNode({
            id: "PRR_old",
            updatedAt: "2026-07-01T00:00:00Z",
            submittedAt: "2026-07-01T00:00:00Z",
          }),
          reviewNode({
            id: "PRR_new",
            updatedAt: "2026-08-02T00:00:00Z",
            submittedAt: "2026-08-02T00:00:00Z",
          }),
        ],
        threads: [
          threadNode([
            reviewCommentNode({
              id: "PRRC_old",
              updatedAt: "2026-07-01T00:00:00Z",
            }),
            reviewCommentNode({
              id: "PRRC_new",
              updatedAt: "2026-08-02T00:00:00Z",
              createdAt: "2026-08-02T00:00:00Z",
              replyTo: { id: "PRRC_old" },
            }),
          ]),
        ],
      }),
    );

    const result = await fetchPrComments(PR_URL, "2026-08-01T00:00:00.000Z", WORKSPACE);

    expect(result.comments.map((comment) => comment.source.id)).toEqual([
      "PRR_new",
      "PRRC_new",
    ]);
    expect(result.comments[1]?.replyToSourceId).toBe("PRRC_old");
    expect(result.comments[1]?.anchor).toBeUndefined();
  });

  it("fails loudly when an inline comment has no commit", async () => {
    stubGh(
      githubParts({
        threads: [
          threadNode([
            reviewCommentNode({ commit: null, originalCommit: null }),
          ]),
        ],
      }),
    );

    await expect(fetchPrComments(PR_URL, undefined, WORKSPACE)).rejects.toMatchObject({
      code: "gh-failed",
      message: "gh graphql returned a review comment without commit",
    });
  });
});

describe("mirrorPrComments", () => {
  it("makes no GitHub call when reconcile matched nothing", async () => {
    const input = previous();
    const result = await mirrorPrComments("p", input);
    expect(ghCalls).toHaveLength(0);
    expect(result).toBe(input);
  });

  it("lands conversation comments, including bots, and skips ones already mirrored", async () => {
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
    stubGh(commentPages([
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
    ]));

    const facts = new Map();
    const result = await mirrorPrComments("p", {
      matches: new Map([["ship", PR_URL]]),
      facts,
    } as PrSyncStepResult);

    expect(result.error).toBeUndefined();
    expect(result.facts).toBe(facts);
    const lines = storedLines("ship");
    expect(lines.map((line) => line.id)).toEqual([
      "already",
      expect.any(String),
      expect.any(String),
    ]);
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
    expect(lines[2]).toMatchObject({
      role: "github-bot",
      name: "github-actions[bot]",
      body: "coverage dropped",
      source: { kind: "github", id: "IC_bot" },
    });
  });

  it("fetches the full history once per process, then only comments updated since", async () => {
    project();
    story("ship");
    stubGh(commentPages([
      page([commentNode()]),
      page([commentNode({ updatedAt: "2099-01-01T00:00:00Z" })]),
    ]));
    const input = {
      matches: new Map([["ship", PR_URL]]),
      facts: new Map(),
    } as PrSyncStepResult;

    await mirrorPrComments("p", input);
    await mirrorPrComments("p", input);

    const conversation = ghCalls.map(queryOf).filter((query) => query.includes("orderBy"));
    expect(conversation[0]).toContain("CREATED_AT");
    expect(conversation[1]).toContain("UPDATED_AT");
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

    const failed = await mirrorPrComments("p", input);
    expect(failed.error).toBe("ship: gh exploded");
    expect(failed.facts).toBe(input.facts);
    expect(storedLines("ship")).toHaveLength(0);
    expect(ghCalls).toHaveLength(1);

    stubGh(commentPages([page([commentNode()])]));
    const retried = await mirrorPrComments("p", input);
    expect(retried.error).toBeUndefined();
    expect(queryOf(ghCalls[1]!)).toContain("CREATED_AT");
    expect(storedLines("ship")).toHaveLength(1);
  });

  it("lands review summaries, inline threads, and bot authors", async () => {
    project();
    story("ship");
    const nested = reviewCommentNode({
      id: "PRRC_nested",
      body: "agree",
      createdAt: "2024-06-01T02:00:00Z",
      updatedAt: "2024-06-01T02:00:00Z",
      replyTo: { id: "PRRC_reply" },
    });
    stubGh(
      githubParts({
        reviews: [reviewNode()],
        threads: [
          threadNode(
            [
              reviewCommentNode(),
              reviewCommentNode({
                id: "PRRC_reply",
                body: "fixed",
                createdAt: "2024-06-01T01:00:00Z",
                updatedAt: "2024-06-01T01:00:00Z",
                replyTo: { id: "PRRC_1" },
                author: { __typename: "Bot", login: "coderabbit[bot]" },
              }),
              nested,
            ],
            { startLine: 10 },
          ),
          threadNode(
            [
              reviewCommentNode({
                id: "PRRC_bot_root",
                body: "this file changed",
                createdAt: "2024-06-05T00:00:00Z",
                updatedAt: "2024-06-05T00:00:00Z",
                author: { __typename: "Bot", login: "dependabot[bot]" },
              }),
            ],
            {
              id: "PRT_bot",
              subjectType: "FILE",
              path: "package.json",
              line: null,
              originalLine: null,
            },
          ),
        ],
      }),
    );

    const result = await mirrorPrComments("p", {
      matches: new Map([["ship", PR_URL]]),
      facts: new Map(),
    } as PrSyncStepResult);

    expect(result.error).toBeUndefined();
    const lines = storedLines("ship");
    const summary = lines.find((line) => line.body === "Looks good overall");
    const root = lines.find((line) => line.body === "rename this");
    const reply = lines.find((line) => line.body === "fixed");
    const nestedLine = lines.find((line) => line.body === "agree");
    const botRoot = lines.find((line) => line.body === "this file changed");
    expect(summary).toMatchObject({
      role: "human",
      name: "ada",
      at: "2024-06-03T00:00:00.000Z",
      source: { kind: "github", id: "PRR_1" },
    });
    expect(summary).not.toHaveProperty("anchor");
    expect(summary).not.toHaveProperty("replyTo");
    expect(root).toMatchObject({
      role: "human",
      anchor: {
        path: "src/app.ts",
        side: "new",
        line: 12,
        startLine: 10,
        commitSha: SHA,
      },
    });
    expect(reply).toMatchObject({
      role: "github-bot",
      name: "coderabbit[bot]",
      replyTo: root?.id,
    });
    expect(reply).not.toHaveProperty("replyToSourceId");
    expect(reply).not.toHaveProperty("anchor");
    expect(nestedLine).toMatchObject({ replyTo: root?.id });
    expect(botRoot).toMatchObject({
      role: "github-bot",
      name: "dependabot[bot]",
      anchor: { path: "package.json", commitSha: SHA },
    });

    const threads = readComments("ship").threads;
    for (const rootId of [root?.id, botRoot?.id]) {
      const thread = threads.find((item) => item.rootId === rootId);
      expect(thread).toMatchObject({ kind: "review", state: "open", readyToTask: true });
      expect(isSubmittable(thread!, [])).toBe(true);
    }
  });

  it("resolves a reply onto a root mirrored on an earlier pass", async () => {
    project();
    story("ship");
    writeFileSync(
      join(dir, "ship", "comments.jsonl"),
      `${JSON.stringify({
        id: "root-1",
        role: "human",
        name: "ada",
        body: "rename this",
        at: "2024-06-01T00:00:00.000Z",
        anchor: { path: "src/app.ts", side: "new", line: 12, commitSha: SHA },
        source: {
          kind: "github",
          id: "PRRC_1",
          url: "https://github.com/acme/widgets/pull/7#discussion_r1",
        },
      })}\n`,
    );
    stubGh(
      githubParts({
        threads: [
          threadNode([
            reviewCommentNode({
              id: "PRRC_reply",
              body: "fixed",
              createdAt: "2024-06-02T00:00:00Z",
              replyTo: { id: "PRRC_1" },
              author: { __typename: "Bot", login: "coderabbit[bot]" },
            }),
          ]),
        ],
      }),
    );

    await mirrorPrComments("p", {
      matches: new Map([["ship", PR_URL]]),
      facts: new Map(),
    } as PrSyncStepResult);

    const lines = storedLines("ship");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toMatchObject({
      role: "github-bot",
      name: "coderabbit[bot]",
      replyTo: "root-1",
    });
  });

  it("skips a reply whose parent is not a tracker comment", async () => {
    project();
    story("ship");
    stubGh(
      githubParts({
        threads: [
          threadNode([
            reviewCommentNode({ id: "PRRC_gone", author: null, body: "deleted" }),
            reviewCommentNode({
              id: "PRRC_orphan",
              body: "reply to nobody",
              createdAt: "2024-06-02T00:00:00Z",
              replyTo: { id: "PRRC_gone" },
            }),
          ]),
        ],
      }),
    );

    const result = await mirrorPrComments("p", {
      matches: new Map([["ship", PR_URL]]),
      facts: new Map(),
    } as PrSyncStepResult);

    expect(result.error).toBeUndefined();
    expect(storedLines("ship")).toHaveLength(0);
  });
});
