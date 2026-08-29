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
    writeTask("t2", { commitSha: SHA, noDiff: true });
    const { readIssueChange } = await loadChange();
    await expect(readIssueChange("t2")).resolves.toEqual({
      state: "empty",
      reason: "no-diff",
    });
  });

  it("returns a loaded change with patch and stats when the commit resolves", async () => {
    writeTask("t3", { commitSha: SHA });
    await stubGitSpawner((args) => {
      if (args[0] === "show" && args.includes("--format=%s")) {
        return mockGitChild({ stdout: "Add feature\n" });
      }
      if (args[0] === "show" && args.includes("--patch")) {
        return mockGitChild({
          stdout: "diff --git a/foo.ts b/foo.ts\n+line\n",
        });
      }
      if (args[0] === "show" && args.includes("--stat")) {
        return mockGitChild({
          stdout: " 2 files changed, 5 insertions(+), 1 deletion(-)\n",
        });
      }
      return mockGitChild({ code: 1, stderr: `unexpected: ${args.join(" ")}` });
    });

    const { readIssueChange } = await loadChange();
    await expect(readIssueChange("t3")).resolves.toEqual({
      state: "loaded",
      commits: [{ sha: SHA, subject: "Add feature" }],
      patch: "diff --git a/foo.ts b/foo.ts\n+line\n",
      stats: { filesChanged: 2, insertions: 5, deletions: 1 },
    });
  });

  it("raises commit-unreachable when the recorded sha does not resolve", async () => {
    writeTask("t4", { commitSha: SHA });
    await stubGitSpawner(() =>
      mockGitChild({
        code: 128,
        stderr: `fatal: bad object ${SHA}`,
      }),
    );

    const { readIssueChange } = await loadChange();
    await expect(readIssueChange("t4")).rejects.toMatchObject({
      code: "commit-unreachable",
      message: expect.stringContaining("bad object"),
    });
  });

  it("propagates other git failures without mapping to commit-unreachable", async () => {
    writeTask("t5", { commitSha: SHA });
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
    writeTask("t-a1", { partOf: "s-a", order: 0, commitSha: sha(1) });
    writeTask("t-missing", { partOf: "s-a", order: 1 });
    writeTask("t-nodiff", {
      partOf: "s-a",
      order: 2,
      commitSha: sha(2),
      noDiff: true,
    });
    writeTask("t-a2", { partOf: "s-a", order: 3, commitSha: sha(3) });
    writeTask("t-stacked", { partOf: "s-stacked", order: 0, commitSha: sha(4) });
    writeTask("t-b1", { partOf: "s-b", order: 0, commitSha: sha(5) });
  }

  it("returns recorded shas in implementation order and skips empty tasks", async () => {
    writeFixtureTree();
    const { collectDescendantCommits } = await loadChange();

    expect(collectDescendantCommits("tree").map((c) => c.sha)).toEqual([
      sha(1),
      sha(3),
      sha(4),
      sha(5),
    ]);
    expect(collectDescendantCommits("s-a").map((c) => c.sha)).toEqual([
      sha(1),
      sha(3),
      sha(4),
    ]);
  });
});
