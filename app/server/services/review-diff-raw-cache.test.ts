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
