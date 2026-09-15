import { EventEmitter } from "node:events";
import type { GitSpawner } from "./git-read.js";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const AT = "2026-07-09T14:00:00.000Z";
const SHA = "0123456789abcdef0123456789abcdef01234567";
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
}) {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();

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

function writeStory(id: string, extra: Record<string, unknown> = {}): void {
  writeIssue(id, {
    kind: "story",
    title: id,
    partOf: "e",
    merged: false,
    order: 0,
    createdAt: AT,
    updatedAt: AT,
    ...extra,
  });
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
  calls?: string[][];
}): Promise<void> {
  const first = opts.commits[0]!;
  const last = opts.commits[opts.commits.length - 1]!;
  const twoDot = `${parentSha(first)}..${last}`;
  const threeDot = `${parentSha(first)}...${last}`;
  return stubGitSpawner((args) => {
    opts.calls?.push([...args]);
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

function stubStorySymdiffGit(opts: {
  last: string;
  mergeBase?: string;
  patch: string;
  shortstat: string;
  subjects: Record<string, string>;
  firstParentCount?: (range: string) => string;
  calls?: string[][];
}): Promise<void> {
  const mergeBase = opts.mergeBase ?? "main";
  const range = `${mergeBase}...${opts.last}`;
  return stubGitSpawner((args) => {
    opts.calls?.push([...args]);
    if (args[0] === "rev-list" && args.includes("--count")) {
      if (!args.includes("--first-parent")) {
        return mockGitChild({ stdout: "5\n" });
      }
      const pair = args[args.length - 1]!;
      const count = opts.firstParentCount?.(pair) ?? "1";
      return mockGitChild({ stdout: `${count}\n` });
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

describe("readIssueChange rollup", () => {
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

  it("returns empty no-descendant-commits when the subtree has no shas", async () => {
    writeRollupFixture([
      { id: "t-empty-a", partOf: "rollup" },
      { id: "t-empty-b", partOf: "rollup", order: 1 },
    ]);
    const { readIssueChange } = await loadChange();
    await expect(readIssueChange("rollup")).resolves.toEqual({
      state: "empty",
      reason: "no-descendant-commits",
    });
  });

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

  it("raises change-too-large with stats when a rollup patch exceeds the ceiling", async () => {
    const c1 = sha(1);
    const c2 = sha(2);
    const hugePatch = "x".repeat(2 * 1024 * 1024 + 1);
    writeRollupFixture([
      { id: "t1", partOf: "rollup", sha: c1, order: 0 },
      { id: "t2", partOf: "rollup", sha: c2, order: 1 },
    ]);

    await stubStorySymdiffGit({
      last: c2,
      patch: hugePatch,
      shortstat: " 50 files changed, 20000 insertions(+), 500 deletions(-)\n",
      subjects: { [c1]: "First", [c2]: "Second" },
    });

    const { readIssueChange } = await loadChange();
    await expect(readIssueChange("rollup")).rejects.toMatchObject({
      code: "change-too-large",
      details: {
        stats: { filesChanged: 50, insertions: 20000, deletions: 500 },
        commitCount: 2,
      },
    });
  });

  it("loads a Story from own-Task shas when a stacked Story would break contiguity", async () => {
    const c1 = sha(1);
    const c2 = sha(2);
    const stacked = sha(9);
    writeRollupFixture([
      { id: "t1", partOf: "rollup", sha: c1, order: 0 },
      { id: "t2", partOf: "rollup", sha: c2, order: 1 },
    ]);
    writeStory("s-stacked-on-rollup", {
      partOf: "e",
      order: 0,
      stackedOn: "rollup",
    });
    writeTask("t-stacked-foreign", {
      partOf: "s-stacked-on-rollup",
      order: 0,
      commits: [stacked],
    });

    await stubStorySymdiffGit({
      last: c2,
      patch: "diff --git a/own.ts b/own.ts\n+own\n",
      shortstat: " 2 files changed, 4 insertions(+), 1 deletion(-)\n",
      subjects: { [c1]: "First", [c2]: "Second" },
      firstParentCount: (range) => (range === `${c1}..${c2}` ? "1" : "3"),
    });

    const { readIssueChange } = await loadChange();
    await expect(readIssueChange("rollup")).resolves.toEqual({
      state: "loaded",
      commits: [
        { sha: c1, subject: "First" },
        { sha: c2, subject: "Second" },
      ],
      patch: "diff --git a/own.ts b/own.ts\n+own\n",
      stats: { filesChanged: 2, insertions: 4, deletions: 1 },
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
      firstParentCount: () => "3",
    });

    const { readIssueChange } = await loadChange();
    await expect(readIssueChange("rollup")).rejects.toMatchObject({
      code: "commits-not-contiguous",
      message: expect.stringContaining(c1),
    });
  });

  it("loads a Story whose last commit is a merge of trunk via three-dot mergeBase", async () => {
    const waypoint = sha(1);
    const mergeOfTrunk = sha(2);
    const calls: string[][] = [];
    writeRollupFixture([
      { id: "t1", partOf: "rollup", sha: waypoint, order: 0 },
      { id: "t-merge", partOf: "rollup", sha: mergeOfTrunk, order: 1 },
    ]);

    await stubStorySymdiffGit({
      last: mergeOfTrunk,
      calls,
      patch: "diff --git a/merged.ts b/merged.ts\n+landed\n",
      shortstat: " 1 file changed, 1 insertion(+)\n",
      subjects: { [waypoint]: "Feature", [mergeOfTrunk]: "Merge main" },
    });

    const { readIssueChange } = await loadChange();
    await expect(readIssueChange("rollup")).resolves.toEqual({
      state: "loaded",
      commits: [
        { sha: waypoint, subject: "Feature" },
        { sha: mergeOfTrunk, subject: "Merge main" },
      ],
      patch: "diff --git a/merged.ts b/merged.ts\n+landed\n",
      stats: { filesChanged: 1, insertions: 1, deletions: 0 },
    });
    expect(calls).toContainEqual([
      "rev-list",
      "--count",
      "--first-parent",
      `${waypoint}..${mergeOfTrunk}`,
    ]);
    expect(calls).toContainEqual([
      "diff",
      "--shortstat",
      `main...${mergeOfTrunk}`,
    ]);
    expect(calls).toContainEqual(["diff", `main...${mergeOfTrunk}`]);
    expect(calls.some((args) => args[0] === "rev-parse")).toBe(false);
  });

  it("raises commits-not-contiguous for an unrecorded first-parent commit between waypoints", async () => {
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
      firstParentCount: (range) => (range === `${c1}..${c2}` ? "2" : "1"),
    });

    const { readIssueChange } = await loadChange();
    await expect(readIssueChange("rollup")).rejects.toMatchObject({
      code: "commits-not-contiguous",
      message: expect.stringContaining(c1),
    });
  });

  it("returns empty no-merge-base when derived mergeBase is unset", async () => {
    writeStory("s-waiting", { stackedOn: "b" });
    writeTask("t-waiting", {
      partOf: "s-waiting",
      commits: [sha(1)],
    });

    const calls: string[][] = [];
    await stubGitSpawner((args) => {
      calls.push([...args]);
      return mockGitChild({ code: 1, stderr: `unexpected: ${args.join(" ")}` });
    });

    const { readIssueChange } = await loadChange();
    await expect(readIssueChange("s-waiting")).resolves.toEqual({
      state: "empty",
      reason: "no-merge-base",
    });
    expect(calls).toEqual([]);
  });

  it("returns empty no-merge-base before no-descendant-commits when mergeBase is unset", async () => {
    writeStory("s-waiting-empty", { stackedOn: "b" });

    const { readIssueChange } = await loadChange();
    await expect(readIssueChange("s-waiting-empty")).resolves.toEqual({
      state: "empty",
      reason: "no-merge-base",
    });
  });

  it("refuses Epic change requests", async () => {
    writeTask("t-epic-child", { partOf: "b", commits: [sha(1)] });
    const { readIssueChange } = await loadChange();
    await expect(readIssueChange("e")).rejects.toMatchObject({
      code: "validation",
      message: expect.stringContaining("Epic diffs are not supported"),
    });
  });
});

describe("readIssueChange", () => {
  it("returns empty no-commit when the Task has no sha", async () => {
    writeTask("t1");
    const { readIssueChange } = await loadChange();
    await expect(readIssueChange("t1")).resolves.toEqual({
      state: "empty",
      reason: "no-commit",
    });
  });

  it("returns empty no-diff when the Task is flagged noDiff", async () => {
    writeTask("t2", { commits: [SHA], noDiff: true });
    const { readIssueChange } = await loadChange();
    await expect(readIssueChange("t2")).resolves.toEqual({
      state: "empty",
      reason: "no-diff",
    });
  });

  it("returns a loaded change with patch and stats when the commit resolves", async () => {
    writeTask("t3", { commits: [SHA] });
    await stubTaskRangeGit({
      commits: [SHA],
      patch: "diff --git a/foo.ts b/foo.ts\n+line\n",
      shortstat: " 2 files changed, 5 insertions(+), 1 deletion(-)\n",
      subjects: { [SHA]: "Add feature" },
    });

    const { readIssueChange } = await loadChange();
    await expect(readIssueChange("t3")).resolves.toEqual({
      state: "loaded",
      commits: [{ sha: SHA, subject: "Add feature" }],
      patch: "diff --git a/foo.ts b/foo.ts\n+line\n",
      stats: { filesChanged: 2, insertions: 5, deletions: 1 },
    });
  });

  it("uses first^..last for a Task whose last commit is a merge", async () => {
    const first = sha(4);
    const mergeCommit = sha(5);
    const calls: string[][] = [];
    writeTask("t-merge", { commits: [first, mergeCommit] });
    await stubTaskRangeGit({
      commits: [first, mergeCommit],
      calls,
      patch: "diff --git a/task.ts b/task.ts\n+merge-task\n",
      shortstat: " 1 file changed, 1 insertion(+)\n",
      subjects: { [first]: "Work", [mergeCommit]: "Merge main" },
    });

    const { readIssueChange } = await loadChange();
    await expect(readIssueChange("t-merge")).resolves.toEqual({
      state: "loaded",
      commits: [
        { sha: first, subject: "Work" },
        { sha: mergeCommit, subject: "Merge main" },
      ],
      patch: "diff --git a/task.ts b/task.ts\n+merge-task\n",
      stats: { filesChanged: 1, insertions: 1, deletions: 0 },
    });
    expect(calls).toContainEqual(["rev-parse", `${first}^`]);
    expect(calls).toContainEqual([
      "diff",
      "--shortstat",
      `${parentSha(first)}..${mergeCommit}`,
    ]);
    expect(calls).toContainEqual(["diff", `${parentSha(first)}..${mergeCommit}`]);
    expect(
      calls.some((args) => args.some((arg) => arg.includes("..."))),
    ).toBe(false);
  });

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

  it("raises commit-unreachable when the recorded sha does not resolve", async () => {
    writeTask("t4", { commits: [SHA] });
    await stubGitSpawner((args) => {
      if (args[0] === "rev-parse" && args[1] === `${SHA}^`) {
        return mockGitChild({
          code: 128,
          stderr: `fatal: bad object ${SHA}`,
        });
      }
      return mockGitChild({
        code: 128,
        stderr: `fatal: bad object ${SHA}`,
      });
    });

    const { readIssueChange } = await loadChange();
    await expect(readIssueChange("t4")).rejects.toMatchObject({
      code: "commit-unreachable",
      message: expect.stringContaining("bad object"),
    });
  });

  it("propagates other git failures without mapping to commit-unreachable", async () => {
    writeTask("t5", { commits: [SHA] });
    await stubGitSpawner(() =>
      mockGitChild({
        code: 128,
        stderr: "fatal: unable to read tree abc",
      }),
    );

    const { readIssueChange } = await loadChange();
    await expect(readIssueChange("t5")).rejects.toMatchObject({
      code: "git-failed",
    });
  });

  it("returns a loaded change when the patch is within the render ceiling", async () => {
    writeTask("t-under", { commits: [SHA] });
    await stubTaskRangeGit({
      commits: [SHA],
      patch: "+small\n",
      shortstat: " 1 file changed, 1 insertion(+)\n",
      subjects: { [SHA]: "Small change" },
    });

    const { readIssueChange } = await loadChange();
    await expect(readIssueChange("t-under")).resolves.toEqual({
      state: "loaded",
      commits: [{ sha: SHA, subject: "Small change" }],
      patch: "+small\n",
      stats: { filesChanged: 1, insertions: 1, deletions: 0 },
    });
  });

  it("raises change-too-large with stats and no patch when a Task patch exceeds the ceiling", async () => {
    writeTask("t-over", { commits: [SHA] });
    const hugePatch = "x".repeat(2 * 1024 * 1024 + 1);
    await stubGitSpawner((args) => {
      if (args[0] === "rev-parse" && args[1] === `${SHA}^`) {
        return mockGitChild({ stdout: `${parentSha(SHA)}\n` });
      }
      if (args[0] === "diff" && args.includes("--shortstat")) {
        return mockGitChild({
          stdout: " 100 files changed, 50000 insertions(+), 100 deletions(-)\n",
        });
      }
      if (args[0] === "diff") {
        return mockGitChild({ stdout: hugePatch });
      }
      if (args[0] === "show" && args.includes("--format=%s")) {
        return mockGitChild({ stdout: "Huge change\n" });
      }
      return mockGitChild({ code: 1, stderr: `unexpected: ${args.join(" ")}` });
    });

    const { readIssueChange } = await loadChange();
    await expect(readIssueChange("t-over")).rejects.toMatchObject({
      code: "change-too-large",
      details: {
        stats: { filesChanged: 100, insertions: 50000, deletions: 100 },
        commitCount: 1,
      },
    });
  });
});

describe("readIssueChangeFile", () => {
  it("refuses Epic change file requests", async () => {
    writeTask("t-epic-child", { partOf: "b", commits: [SHA] });
    const { readIssueChangeFile } = await loadChange();
    await expect(
      readIssueChangeFile("e", SHA, "src/foo.ts"),
    ).rejects.toMatchObject({
      code: "validation",
      message: expect.stringContaining("Epic diffs are not supported"),
    });
  });
});

describe("collectDescendantCommits", () => {
  function writeFixtureTree(): void {
    writeIssue("tree", {
      kind: "epic",
      title: "Tree",
      partOf: "p",
      order: 1,
      createdAt: AT,
      updatedAt: AT,
    });
    writeStory("s-a", { partOf: "tree", order: 0 });
    writeStory("s-b", { partOf: "tree", order: 1 });
    writeStory("s-stacked", { partOf: "tree", order: 0, stackedOn: "s-a" });
    writeTask("t-a1", { partOf: "s-a", order: 0, commits: [sha(1)] });
    writeTask("t-missing", { partOf: "s-a", order: 1 });
    writeTask("t-nodiff", {
      partOf: "s-a",
      order: 2,
      commits: [sha(2)],
      noDiff: true,
    });
    writeTask("t-a2", { partOf: "s-a", order: 3, commits: [sha(3)] });
    writeTask("t-stacked", { partOf: "s-stacked", order: 0, commits: [sha(4)] });
    writeTask("t-b1", { partOf: "s-b", order: 0, commits: [sha(5)] });
  }

  it("returns recorded shas in implementation order and skips empty tasks", async () => {
    writeFixtureTree();
    writeTask("t-multi", {
      partOf: "s-b",
      order: 1,
      commits: [sha(6), sha(7)],
    });
    const { collectDescendantCommits } = await loadChange();

    expect(collectDescendantCommits("tree").map((c) => c.sha)).toEqual([
      sha(1),
      sha(3),
      sha(4),
      sha(5),
      sha(6),
      sha(7),
    ]);
    expect(collectDescendantCommits("s-a").map((c) => c.sha)).toEqual([
      sha(1),
      sha(3),
    ]);
  });
});
