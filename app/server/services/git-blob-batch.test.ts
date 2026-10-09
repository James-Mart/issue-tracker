import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { git } from "../../cli-story-worktree.test-fixtures.js";

let workspace: string;
let sha: string;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), "issue-tracker-git-blob-"));
  git(workspace, ["init", "-b", "main"]);
  writeFileSync(join(workspace, "empty.txt"), "");
  writeFileSync(join(workspace, "nonewline.txt"), "no newline");
  writeFileSync(join(workspace, "lines.txt"), "one\ntwo\n");
  git(workspace, ["add", "-A"]);
  git(workspace, ["commit", "-m", "init"]);
  sha = git(workspace, ["rev-parse", "HEAD"]);
});

afterEach(async () => {
  const { closeGitBlobSessionsForTests } = await import("./git-blob-batch.js");
  closeGitBlobSessionsForTests();
  const { setGitSpawnerForTests } = await import("./git-read.js");
  setGitSpawnerForTests(null);
  rmSync(workspace, { recursive: true, force: true });
});

async function read(path: string, at = sha) {
  const { readPathAtCommit } = await import("./git-blob-batch.js");
  return readPathAtCommit(workspace, at, path);
}

describe("readPathAtCommit", () => {
  it("returns blob bytes, including empty files and files with no trailing newline", async () => {
    await expect(read("empty.txt")).resolves.toBe("");
    await expect(read("nonewline.txt")).resolves.toBe("no newline");
    await expect(read("lines.txt")).resolves.toBe("one\ntwo\n");
  });
});
