import { ChildProcess, type ChildProcessByStdio } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough, type Readable } from "node:stream";
import { afterEach, beforeEach, vi } from "vitest";
import { refreshStorePathsFromEnv } from "../config.js";
import { setGhSpawnerForTests, type GhSpawner } from "./delivery.js";
import { resetPrCommentMirrorForTests } from "./pr-comment-mirror.js";

const AT = "2026-07-09T14:00:00.000Z";
export const PR_URL = "https://github.com/acme/widgets/pull/7";
export const WORKSPACE = "/repo/root";
const SHA = "a".repeat(40);

export let dir!: string;
export let ghCalls: string[][] = [];

function writeIssue(id: string, body: Record<string, unknown>): void {
  mkdirSync(join(dir, id), { recursive: true });
  writeFileSync(join(dir, id, "issue.json"), JSON.stringify({ id, ...body }));
}

export function mockChild(opts: {
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

export function stubGh(respond: (query: string) => string): void {
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
export function commentPages(pages: string[]): (query: string) => string {
  let index = 0;
  return (query) => {
    if (query.includes("reviewThreads(")) return connectionPage("reviewThreads", []);
    if (query.includes("reviews(")) return connectionPage("reviews", []);
    const stdout = pages[index] ?? pages[pages.length - 1] ?? "";
    index += 1;
    return stdout;
  };
}

export function queryOf(args: string[]): string {
  return args.find((arg) => arg.startsWith("query="))?.slice("query=".length) ?? "";
}

export function commentNode(overrides: Record<string, unknown> = {}) {
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

export function page(nodes: unknown[], hasNextPage = false, endCursor: string | null = null) {
  return connectionPage("comments", nodes, hasNextPage, endCursor);
}

export function reviewCommentNode(overrides: Record<string, unknown> = {}) {
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

export function threadNode(
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

export function githubParts(parts: {
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
    if (query.includes("reviews(")) return connectionPage("reviews", []);
    return connectionPage("comments", []);
  };
}

export function project(): void {
  writeIssue("p", {
    kind: "project",
    title: "P",
    workspace: WORKSPACE,
    order: 0,
    createdAt: AT,
    updatedAt: AT,
  });
}

export function story(id: string): void {
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

export function storedLines(id: string): Record<string, unknown>[] {
  const path = join(dir, id, "comments.jsonl");
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (err) {
    // A story with no comments yet has no log file.
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  return text
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

/** Fresh store and `gh` stub for one PR comment mirror test file. */
export function usePrCommentMirrorHarness(): void {
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
}
