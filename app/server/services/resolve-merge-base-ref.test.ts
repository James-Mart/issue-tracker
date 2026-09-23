import { EventEmitter } from "node:events";
import { execFileSync } from "child_process";
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import { runIssueCli } from "../../cli-program.js";
import {
  dir,
  env,
  nextAt,
  useCliTestFixtures,
  writeIssue,
} from "../../cli.test-helpers.js";
import { IssueError } from "./errors.js";
import {
  setGitSpawnerForTests,
  type GitSpawner,
} from "./git-read.js";
import {
  setGitWriteSpawnerForTests,
  type GitWriteSpawner,
} from "./git-write.js";
import { BEHIND_MERGE_BASE_NO_WORKTREE_ERROR } from "./merge-base-task.js";
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
  error?: NodeJS.ErrnoException;
}) {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();

  setImmediate(() => {
    if (opts.error) {
      child.emit("error", opts.error);
      return;
    }
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
  it("returns the local branch name when origin is missing", async () => {
    const repo = initRepo();

    await expect(resolveMergeBaseRef(repo, "main")).resolves.toBe("main");
  });

  it("returns origin/<mergeBase> after a successful fetch", async () => {
    const repo = initRepo();
    const bare = mkdtempSync(join(tmpdir(), "issue-resolve-mb-bare-"));
    git(bare, ["init", "--bare", "-b", "main"]);
    git(repo, ["remote", "add", "origin", bare]);
    git(repo, ["push", "origin", "main"]);

    await expect(resolveMergeBaseRef(repo, "main")).resolves.toBe("origin/main");
  });

  it("returns the local branch name when the remote ref is missing", async () => {
    const repo = initRepo();
    const bare = mkdtempSync(join(tmpdir(), "issue-resolve-mb-bare-"));
    git(bare, ["init", "--bare", "-b", "develop"]);
    git(repo, ["remote", "add", "origin", bare]);
    git(repo, ["push", "origin", "HEAD:develop"]);

    await expect(resolveMergeBaseRef(repo, "main")).resolves.toBe("main");

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

  it("does not fetch when origin is missing", async () => {
    const repo = initRepo();
    let fetchCalled = false;
    setGitWriteSpawnerForTests((_command, args) => {
      if (args[0] === "fetch") fetchCalled = true;
      return mockGitChild({});
    });

    await expect(resolveMergeBaseRef(repo, "main")).resolves.toBe("main");
    expect(fetchCalled).toBe(false);
  });
});

describe("storyMergeBaseRef", () => {
  useCliTestFixtures();

  function seedStory(
    workspace: string,
    worktreePath: string,
    branchName = "feat/story",
  ): void {
    git(workspace, ["branch", branchName]);
    writeIssue("p", {
      kind: "project",
      title: "P",
      workspace,
      createdAt: nextAt(),
      updatedAt: nextAt(),
    });
    writeIssue("e", {
      kind: "epic",
      title: "E",
      partOf: "p",
      createdAt: nextAt(),
      updatedAt: nextAt(),
    });
    writeIssue("s", {
      kind: "story",
      title: "Story",
      partOf: "e",
      merged: false,
      branchName,
      worktreePath,
      createdAt: nextAt(),
      updatedAt: nextAt(),
    });
  }

  it("prints the resolved ref via story get", async () => {
    const repo = initRepo();
    seedStory(repo, repo, "feat/story");

    const mergeBase = await runIssueCli(["story", "get", "s", "mergeBase"], {
      env: env(),
    });
    expect(mergeBase.status).toBe(0);
    expect(mergeBase.stdout.trim()).toBe("main");

    const result = await runIssueCli(["story", "get", "s", "mergeBaseRef"], {
      env: env(),
    });
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("main");
    expect(
      JSON.parse(readFileSync(join(dir, "s", "issue.json"), "utf8")).mergeBaseRef,
    ).toBeUndefined();
  });

  it("fails loudly when the worktree cannot be read", async () => {
    const repo = initRepo();
    seedStory(repo, join(dir, "missing-worktree"));

    const result = await runIssueCli(["story", "get", "s", "mergeBaseRef"], {
      env: env(),
    });
    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain(BEHIND_MERGE_BASE_NO_WORKTREE_ERROR("s"));
  });

  it("returns origin/<mergeBase> when fetch succeeds", async () => {
    const repo = initRepo();
    const bare = mkdtempSync(join(tmpdir(), "issue-story-mb-bare-"));
    git(bare, ["init", "--bare", "-b", "main"]);
    git(repo, ["remote", "add", "origin", bare]);
    git(repo, ["push", "origin", "main"]);
    seedStory(repo, repo);

    const result = await runIssueCli(["story", "get", "s", "mergeBaseRef"], {
      env: env(),
    });
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("origin/main");

    rmSync(bare, { recursive: true, force: true });
  });

  it("exits nonzero when origin fetch is unreachable", async () => {
    const repo = initRepo();
    git(repo, ["remote", "add", "origin", "git@example.com:org/repo.git"]);
    seedStory(repo, repo);

    setGitWriteSpawnerForTests((command, args, options) => {
      if (args[0] === "fetch") {
        return mockGitChild({
          code: 128,
          stderr: "fatal: Could not read from remote repository.",
        });
      }
      return spawn(command, args, {
        ...options,
        stdio: ["ignore", "pipe", "pipe"],
      });
    });

    const result = await runIssueCli(["story", "get", "s", "mergeBaseRef"], {
      env: env(),
    });
    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr.length).toBeGreaterThan(0);
  });
});
