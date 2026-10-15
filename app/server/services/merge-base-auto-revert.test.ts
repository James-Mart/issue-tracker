import { ChildProcess, type ChildProcessByStdio } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough, type Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { refreshStorePathsFromEnv } from "../config.js";
import { resolveMergeBase } from "../resolve-merge-base.js";
import { setGhSpawnerForTests, type GhSpawner } from "./delivery.js";
import { setGitSpawnerForTests, type GitSpawner } from "./git-read.js";
import { readAll } from "./issues.js";
import { revertLandedRootMergeBases } from "./merge-base-auto-revert.js";

const AT = "2026-07-09T14:00:00.000Z";
const WORKSPACE = "/repo/root";
const ORIGIN = "git@github.com:acme/widgets.git";

let dir: string;
let ghCalls: string[][] = [];

function writeIssue(id: string, body: Record<string, unknown>): void {
  mkdirSync(join(dir, id), { recursive: true });
  writeFileSync(join(dir, id, "issue.json"), JSON.stringify({ id, ...body }));
}

function rawIssue(id: string): Record<string, unknown> {
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

function stubGh(handler: (args: string[]) => ReturnType<typeof mockChild>): void {
  const spawner: GhSpawner = (_command, args) => {
    ghCalls.push(args);
    return handler(args);
  };
  setGhSpawnerForTests(spawner);
}

function queryOf(args: string[]): string {
  return args.find((arg) => arg.startsWith("query="))?.slice("query=".length) ?? "";
}

function graphql(repository: Record<string, unknown>) {
  return mockChild({
    stdout: JSON.stringify({ data: { repository } }),
  });
}

function story(id: string, extra: Record<string, unknown> = {}): void {
  writeIssue(id, {
    kind: "story",
    title: id,
    partOf: "p",
    order: 0,
    createdAt: AT,
    updatedAt: AT,
    ...extra,
  });
}

function derivedMergeBase(id: string): string | undefined {
  const { issues } = readAll();
  const storyIssue = issues.find((issue) => issue.id === id);
  if (storyIssue?.kind !== "story") return undefined;
  return resolveMergeBase(storyIssue, issues, undefined, "main");
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "merge-base-auto-revert-"));
  vi.stubEnv("ISSUES_DIR", dir);
  refreshStorePathsFromEnv();
  ghCalls = [];
  stubOrigin(ORIGIN);
  writeIssue("p", {
    kind: "project",
    title: "p",
    workspace: WORKSPACE,
    trunk: "main",
    order: 0,
    createdAt: AT,
    updatedAt: AT,
  });
});

afterEach(() => {
  setGhSpawnerForTests(null);
  setGitSpawnerForTests(null);
  vi.unstubAllEnvs();
  refreshStorePathsFromEnv();
  rmSync(dir, { recursive: true, force: true });
});

describe("revertLandedRootMergeBases", () => {
  it("clears a locked root override when its branch has merged into trunk", async () => {
    story("root", {
      mergeBaseOverride: "feat/base",
      mergePolicy: "manual",
      prUrl: "https://github.com/acme/widgets/pull/9",
      branchName: "feat/root",
    });
    story("stacked", {
      stackedOn: "root",
      branchName: "feat/stacked",
      order: 1,
    });
    let query = "";
    stubGh((args) => {
      query = queryOf(args);
      return graphql({ r_0: { nodes: [{ number: 4 }] } });
    });

    const result = await revertLandedRootMergeBases("p");

    expect(query).toContain("states: [MERGED]");
    expect(query).toContain('headRefName: "feat/base"');
    expect(query).toContain('baseRefName: "main"');
    expect(result).toEqual({ reverted: ["root"] });
    expect(rawIssue("root")).not.toHaveProperty("mergeBaseOverride");
    expect(rawIssue("root").mergePolicy).toBe("manual");
    expect(rawIssue("root").prUrl).toBe("https://github.com/acme/widgets/pull/9");
    expect(derivedMergeBase("root")).toBe("main");
    expect(derivedMergeBase("stacked")).toBe("feat/root");
    expect(ghCalls).toHaveLength(1);
  });
});
