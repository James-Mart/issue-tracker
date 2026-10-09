import { execFileSync } from "child_process";
import { ChildProcess, type ChildProcessByStdio } from "node:child_process";
import { PassThrough, type Readable } from "node:stream";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import { IssueError } from "./errors.js";
import { setGitSpawnerForTests, type GitSpawner } from "./git-read.js";
import { setGitWriteSpawnerForTests, type GitWriteSpawner } from "./git-write.js";
import { resolveMergeBaseRef } from "./resolve-merge-base-ref.js";

const GIT = [
  "-c",
  "user.name=test",
  "-c",
  "user.email=test@example.com",
  "-c",
  "commit.gpgsign=false",
];

function git(repo: string, args: string[]): string {
  return execFileSync("git", [...GIT, ...args], {
    cwd: repo,
    encoding: "utf8",
  }).trim();
}

function initRepo(): string {
  const repo = mkdtempSync(join(tmpdir(), "issue-resolve-mb-ref-"));
  git(repo, ["init", "-b", "main"]);
  writeFileSync(join(repo, "README"), "seed\n");
  git(repo, ["add", "README"]);
  git(repo, ["commit", "-m", "initial"]);
  return repo;
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

afterEach(() => {
  setGitSpawnerForTests(null);
  setGitWriteSpawnerForTests(null);
});

describe("resolveMergeBaseRef", () => {
  it("returns origin/<mergeBase> after a successful fetch", async () => {
    const repo = initRepo();
    const bare = mkdtempSync(join(tmpdir(), "issue-resolve-mb-bare-"));
    git(bare, ["init", "--bare", "-b", "main"]);
    git(repo, ["remote", "add", "origin", bare]);
    git(repo, ["push", "origin", "main"]);

    await expect(resolveMergeBaseRef(repo, "main")).resolves.toBe("origin/main");

    rmSync(bare, { recursive: true, force: true });
  });

  it("throws git-failed when fetch fails for other reasons", async () => {
    const spawner: GitWriteSpawner = (_command, args) => {
      if (args[0] === "fetch") {
        return mockGitChild({
          code: 128,
          stderr: "fatal: Could not read from remote repository.",
        });
      }
      return mockGitChild({});
    };
    setGitWriteSpawnerForTests(spawner);

    const readSpawner: GitSpawner = (_command, args) => {
      if (args[0] === "remote" && args[1] === "get-url") {
        return mockGitChild({ stdout: "git@github.com:org/repo.git\n" });
      }
      return mockGitChild({});
    };
    setGitSpawnerForTests(readSpawner);

    await expect(resolveMergeBaseRef("/repo", "main")).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof IssueError &&
        err.code === "git-failed" &&
        err.message.includes("Could not read from remote"),
    );
  });
});
