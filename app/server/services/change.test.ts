import { ChildProcess, type ChildProcessByStdio } from "node:child_process";
import { PassThrough, type Readable } from "node:stream";
import type { GitSpawner } from "./git-read.js";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const AT = "2026-07-09T14:00:00.000Z";
const WORKSPACE = "/repo/root";

let dir: string;

function writeIssue(id: string, body: Record<string, unknown>): void {
  mkdirSync(join(dir, id), { recursive: true });
  writeFileSync(join(dir, id, "issue.json"), JSON.stringify({ id, ...body }));
}

function mockGitChild(opts: {
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

function stubGitSpawner(
  handler: (args: string[], workspace: string) => ReturnType<typeof mockGitChild>,
): Promise<void> {
  return import("./git-read.js").then(({ setGitSpawnerForTests }) => {
    const spawner: GitSpawner = (_command, args, options) =>
      handler(args, options.cwd);
    setGitSpawnerForTests(spawner);
  });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "issue-tracker-change-"));
  vi.resetModules();
  vi.stubEnv("ISSUES_DIR", dir);
  writeIssue("p", {
    kind: "project",
    title: "P",
    workspace: WORKSPACE,
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
  writeIssue("b", {
    kind: "story",
    title: "B",
    partOf: "e",
    merged: false,
    order: 0,
    createdAt: AT,
    updatedAt: AT,
  });
});

afterEach(async () => {
  const { setGitSpawnerForTests } = await import("./git-read.js");
  setGitSpawnerForTests(null);
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

async function loadChange() {
  return import("./change.js");
}

function writeTask(id: string, extra: Record<string, unknown> = {}): void {
  writeIssue(id, {
    kind: "task",
    title: id,
    partOf: "b",
    status: "done",
    order: 0,
    createdAt: AT,
    updatedAt: AT,
    ...extra,
  });
}

function sha(n: number): string {
  return n.toString(16).padStart(40, "0");
}

function parentSha(shaValue: string): string {
  const n = Number.parseInt(shaValue.slice(0, 8), 16);
  return (n - 1).toString(16).padStart(40, "0");
}

function stubTaskRangeGit(opts: {
  commits: string[];
  patch: string;
  shortstat: string;
  subjects: Record<string, string>;
}): Promise<void> {
  const first = opts.commits[0]!;
  const last = opts.commits[opts.commits.length - 1]!;
  const twoDot = `${parentSha(first)}..${last}`;
  const threeDot = `${parentSha(first)}...${last}`;
  return stubGitSpawner((args) => {
    if (args[0] === "rev-parse" && args[1] === `${first}^`) {
      return mockGitChild({ stdout: `${parentSha(first)}\n` });
    }
    if (args[0] === "diff" && args.includes("--shortstat")) {
      return mockGitChild({ stdout: opts.shortstat });
    }
    if (args[0] === "diff") {
      if (args.includes(threeDot)) {
        return mockGitChild({
          code: 1,
          stderr: `unexpected three-dot Task range: ${args.join(" ")}`,
        });
      }
      if (!args.includes(twoDot)) {
        return mockGitChild({
          code: 1,
          stderr: `unexpected Task range: ${args.join(" ")}`,
        });
      }
      return mockGitChild({ stdout: opts.patch });
    }
    if (args[0] === "show" && args.includes("--format=%s")) {
      const shaArg = args[args.length - 1]!;
      return mockGitChild({ stdout: `${opts.subjects[shaArg] ?? "?"}\n` });
    }
    return mockGitChild({ code: 1, stderr: `unexpected: ${args.join(" ")}` });
  });
}

function mockFirstParentHistory(tip: string, ...foreign: string[]): string {
  return [...foreign, tip].join("\n") + "\n";
}

function firstParentHistoryForRange(
  range: string,
  contiguityShas: string[],
  custom?: (range: string) => string,
): string {
  if (custom) return custom(range);
  const [from, to] = range.split("..");
  const fromIdx = contiguityShas.indexOf(from!);
  const toIdx = contiguityShas.indexOf(to!);
  if (toIdx === -1 || (fromIdx !== -1 && toIdx <= fromIdx)) {
    throw new Error(`bad contiguity range ${range} for shas ${contiguityShas.join(",")}`);
  }
  const start = fromIdx === -1 ? 0 : fromIdx + 1;
  return `${contiguityShas.slice(start, toIdx + 1).join("\n")}\n`;
}

function stubStorySymdiffGit(opts: {
  last: string;
  patch: string;
  shortstat: string;
  subjects: Record<string, string>;
  contiguityShas?: string[];
  firstParentHistory?: (range: string) => string;
}): Promise<void> {
  const range = `main...${opts.last}`;
  const contiguityShas = opts.contiguityShas ?? [opts.last];
  return stubGitSpawner((args) => {
    if (args[0] === "remote" && args[1] === "get-url" && args[2] === "origin") {
      return mockGitChild({ code: 2, stderr: "No such remote 'origin'\n" });
    }
    if (args[0] === "rev-list" && args.includes("--first-parent")) {
      const revRange = args[args.length - 1]!;
      const history = firstParentHistoryForRange(
        revRange,
        contiguityShas,
        opts.firstParentHistory,
      );
      return mockGitChild({ stdout: history });
    }
    if (args[0] === "diff" && args.includes("--shortstat")) {
      if (!args.includes(range)) {
        return mockGitChild({
          code: 1,
          stderr: `unexpected shortstat: ${args.join(" ")}`,
        });
      }
      return mockGitChild({ stdout: opts.shortstat });
    }
    if (args[0] === "diff") {
      if (!args.includes(range)) {
        return mockGitChild({
          code: 1,
          stderr: `unexpected diff: ${args.join(" ")}`,
        });
      }
      return mockGitChild({ stdout: opts.patch });
    }
    if (args[0] === "show" && args.includes("--format=%s")) {
      const shaArg = args[args.length - 1]!;
      return mockGitChild({ stdout: `${opts.subjects[shaArg] ?? "?"}\n` });
    }
    return mockGitChild({ code: 1, stderr: `unexpected: ${args.join(" ")}` });
  });
}

function writeRollupFixture(
  tasks: Array<{ id: string; partOf: string; sha?: string; order?: number }>,
): void {
  writeIssue("rollup", {
    kind: "story",
    title: "Rollup",
    partOf: "e",
    merged: false,
    order: 1,
    createdAt: AT,
    updatedAt: AT,
  });
  for (const task of tasks) {
    writeIssue(task.id, {
      kind: "task",
      title: task.id,
      partOf: task.partOf,
      status: "done",
      order: task.order ?? 0,
      createdAt: AT,
      updatedAt: AT,
      ...(task.sha ? { commits: [task.sha] } : {}),
    });
  }
}

describe("readIssueChange rollup", () => {
  it("returns a loaded net diff across a contiguous commit set", async () => {
    const c1 = sha(1);
    const c2 = sha(2);
    const c3 = sha(3);
    writeRollupFixture([
      { id: "t1", partOf: "rollup", sha: c1, order: 0 },
      { id: "t2", partOf: "rollup", sha: c2, order: 1 },
      { id: "t3", partOf: "rollup", sha: c3, order: 2 },
    ]);

    await stubStorySymdiffGit({
      last: c3,
      contiguityShas: [c1, c2, c3],
      patch: "diff --git a/net.ts b/net.ts\n+rollup\n",
      shortstat: " 3 files changed, 10 insertions(+), 2 deletions(-)\n",
      subjects: { [c1]: "First", [c2]: "Second", [c3]: "Third" },
    });

    const { readIssueChange } = await loadChange();
    await expect(readIssueChange("rollup")).resolves.toEqual({
      state: "loaded",
      commits: [
        { sha: c1, subject: "First" },
        { sha: c2, subject: "Second" },
        { sha: c3, subject: "Third" },
      ],
      patch: "diff --git a/net.ts b/net.ts\n+rollup\n",
      stats: { filesChanged: 3, insertions: 10, deletions: 2 },
    });
  });

  it("raises commits-not-contiguous when foreign commits sit between recorded shas", async () => {
    const c1 = sha(1);
    const c2 = sha(2);
    writeRollupFixture([
      { id: "t1", partOf: "rollup", sha: c1, order: 0 },
      { id: "t2", partOf: "rollup", sha: c2, order: 1 },
    ]);

    await stubStorySymdiffGit({
      last: c2,
      patch: "unused",
      shortstat: "unused",
      subjects: {},
      firstParentHistory: () => mockFirstParentHistory(c2, sha(99), sha(100)),
    });

    const { readIssueChange } = await loadChange();
    await expect(readIssueChange("rollup")).rejects.toMatchObject({
      code: "commits-not-contiguous",
      message: expect.stringContaining(c1),
    });
  });
});

describe("readIssueChange", () => {
  it("returns a loaded range diff when the Task has three commits", async () => {
    const c1 = sha(1);
    const c2 = sha(2);
    const c3 = sha(3);
    writeTask("t-series", { commits: [c1, c2, c3] });
    await stubTaskRangeGit({
      commits: [c1, c2, c3],
      patch: "diff --git a/a.ts b/a.ts\n+one\n+two\n+three\n",
      shortstat: " 1 file changed, 3 insertions(+)\n",
      subjects: { [c1]: "First", [c2]: "Second", [c3]: "Third" },
    });

    const { readIssueChange } = await loadChange();
    await expect(readIssueChange("t-series")).resolves.toEqual({
      state: "loaded",
      commits: [
        { sha: c1, subject: "First" },
        { sha: c2, subject: "Second" },
        { sha: c3, subject: "Third" },
      ],
      patch: "diff --git a/a.ts b/a.ts\n+one\n+two\n+three\n",
      stats: { filesChanged: 1, insertions: 3, deletions: 0 },
    });
  });
});
