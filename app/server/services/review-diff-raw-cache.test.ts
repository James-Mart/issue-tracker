import { spawn, type ChildProcessByStdio } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Readable, Writable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { git } from "../../cli-story-worktree.test-fixtures.js";
import { setGitSpawnerForTests, type GitSpawner } from "./git-read.js";
import { clearRawDiffCacheForTests, readDiffBlobs } from "./review-diff.js";

let workspace: string;
let rawDiffs: string[][];

function trackRawDiffs(): void {
  rawDiffs = [];
  const spawner: GitSpawner = (command, args, options) => {
    if (args[0] === "diff" && args.includes("--raw")) rawDiffs.push(args);
    return spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: options.stdio ?? ["ignore", "pipe", "pipe"],
    }) as ChildProcessByStdio<Writable | null, Readable, Readable>;
  };
  setGitSpawnerForTests(spawner);
}

beforeEach(() => {
  clearRawDiffCacheForTests();
  workspace = mkdtempSync(join(tmpdir(), "issue-tracker-raw-diff-"));
  git(workspace, ["init", "-b", "main"]);
  mkdirSync(join(workspace, "src"));
  writeFileSync(join(workspace, "src", "a.txt"), "alpha\n");
  git(workspace, ["add", "src/a.txt"]);
  git(workspace, ["commit", "-m", "base"]);
  trackRawDiffs();
});

afterEach(() => {
  setGitSpawnerForTests(null);
  clearRawDiffCacheForTests();
  rmSync(workspace, { recursive: true, force: true });
});

function commitStory(message: string, body: string): string {
  git(workspace, ["checkout", "-q", "story"]);
  writeFileSync(join(workspace, "src", "a.txt"), body);
  git(workspace, ["add", "src/a.txt"]);
  git(workspace, ["commit", "-m", message]);
  return git(workspace, ["rev-parse", "HEAD"]);
}

describe("shared git diff --raw", () => {
  it("runs git diff --raw once for a repeated commit pair", async () => {
    git(workspace, ["checkout", "-q", "-b", "story"]);
    const tip = commitStory("beta", "alpha\nbeta\n");
    const base = git(workspace, ["rev-parse", `${tip}^`]);
    const range = `${base}..${tip}`;

    const first = await readDiffBlobs(workspace, range);
    const second = await readDiffBlobs(workspace, range);

    expect(second).toEqual(first);
    expect(first).toEqual([
      {
        path: "src/a.txt",
        blobSha: git(workspace, ["rev-parse", `${tip}:src/a.txt`]),
      },
    ]);
    expect(rawDiffs).toHaveLength(1);
    expect(rawDiffs[0]).toContain(range);
  });

  it("shares one raw diff between a three-dot ref range and its resolved commits", async () => {
    git(workspace, ["checkout", "-q", "-b", "story"]);
    const tip = commitStory("beta", "alpha\nbeta\n");
    const base = git(workspace, ["merge-base", "main", tip]);

    const fromRef = await readDiffBlobs(workspace, `main...${tip}`);
    const fromShas = await readDiffBlobs(workspace, `${base}..${tip}`);

    expect(fromShas).toEqual(fromRef);
    expect(fromRef.map((file) => file.path)).toEqual(["src/a.txt"]);
    expect(rawDiffs).toHaveLength(1);
    expect(rawDiffs[0]).toContain(`${base}..${tip}`);
  });

  it("shares one in-flight raw diff across concurrent callers", async () => {
    git(workspace, ["checkout", "-q", "-b", "story"]);
    const tip = commitStory("beta", "alpha\nbeta\n");
    const base = git(workspace, ["rev-parse", `${tip}^`]);
    const range = `${base}..${tip}`;

    const [first, second] = await Promise.all([
      readDiffBlobs(workspace, range),
      readDiffBlobs(workspace, range),
    ]);

    expect(second).toEqual(first);
    expect(rawDiffs).toHaveLength(1);
  });

  it("keeps a separate raw diff per commit pair", async () => {
    git(workspace, ["checkout", "-q", "-b", "story"]);
    const first = commitStory("beta", "alpha\nbeta\n");
    const second = commitStory("gamma", "alpha\nbeta\ngamma\n");
    const root = git(workspace, ["rev-parse", `${first}^`]);

    await readDiffBlobs(workspace, `${root}..${first}`);
    await readDiffBlobs(workspace, `${first}..${second}`);

    expect(rawDiffs).toHaveLength(2);
  });

  it("reuses the raw diff when the named base moves but the merge base does not", async () => {
    git(workspace, ["checkout", "-q", "-b", "story"]);
    const tip = commitStory("beta", "alpha\nbeta\n");
    const first = await readDiffBlobs(workspace, `main...${tip}`);

    git(workspace, ["checkout", "-q", "main"]);
    writeFileSync(join(workspace, "src", "main-only.txt"), "m\n");
    git(workspace, ["add", "src/main-only.txt"]);
    git(workspace, ["commit", "-m", "on main"]);

    const second = await readDiffBlobs(workspace, `main...${tip}`);
    expect(second).toEqual(first);
    expect(second.map((file) => file.path)).toEqual(["src/a.txt"]);
    expect(rawDiffs).toHaveLength(1);
  });

  it("recomputes when a branch moves to a different merge base", async () => {
    git(workspace, ["checkout", "-q", "-b", "story"]);
    const tip = commitStory("beta", "alpha\nbeta\n");
    const before = await readDiffBlobs(workspace, `main...${tip}`);
    expect(before.map((file) => file.path)).toEqual(["src/a.txt"]);

    git(workspace, ["checkout", "-q", "main"]);
    git(workspace, ["reset", "--hard", tip]);

    const after = await readDiffBlobs(workspace, `main...${tip}`);
    expect(after).toEqual([]);
    expect(rawDiffs).toHaveLength(2);

    const again = await readDiffBlobs(workspace, `main...${tip}`);
    expect(again).toEqual([]);
    expect(rawDiffs).toHaveLength(2);
  });
});
