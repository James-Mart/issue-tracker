import { spawn, type ChildProcess, type ChildProcessByStdio } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Readable, Writable } from "node:stream";
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

  it("returns null when the commit exists and the path does not", async () => {
    await expect(read("gone.txt")).resolves.toBeNull();
  });

  it("uses git show when the commit is not in the repo", async () => {
    await expect(
      read("gone.txt", "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef"),
    ).resolves.toBeNull();
    await expect(
      read("lines.txt", "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef"),
    ).rejects.toMatchObject({ code: "git-failed" });
    await expect(read("lines.txt", "not-a-rev")).rejects.toMatchObject({
      code: "commit-unreachable",
    });
  });

  it("serves a second full-id read from the (sha, path) cache after cat-file exits", async () => {
    const { readPathAtCommit } = await import("./git-blob-batch.js");
    const { setGitSpawnerForTests } = await import("./git-read.js");
    const catFiles: ChildProcess[] = [];
    setGitSpawnerForTests((command, args, options) => {
      const child = spawn(command, args, {
        cwd: options.cwd,
        env: options.env,
        stdio: options.stdio ?? ["ignore", "pipe", "pipe"],
      });
      if (args[0] === "cat-file") catFiles.push(child);
      return child as ChildProcessByStdio<Writable | null, Readable, Readable>;
    });

    const first = await readPathAtCommit(workspace, sha, "lines.txt");
    expect(first).toBe("one\ntwo\n");
    expect(catFiles).toHaveLength(1);
    catFiles[0]!.kill();
    await new Promise<void>((resolve) => {
      catFiles[0]!.once("close", () => resolve());
    });

    const second = await readPathAtCommit(workspace, sha, "lines.txt");
    expect(second).toEqual(first);
    expect(catFiles).toHaveLength(1);
  });
});
