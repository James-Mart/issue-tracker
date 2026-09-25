import {
  ChildProcess,
  execFileSync,
  spawn,
  type ChildProcessWithoutNullStreams,
} from "child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { PassThrough } from "stream";
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
import { setGitWriteSpawnerForTests } from "./git-write.js";
import { mergeBaseHelper } from "../../src/features/issues/lib/story-append-actions.js";
import {
  BEHIND_MERGE_BASE_NO_WORKTREE_ERROR,
  UPDATE_FROM_MERGE_BASE_OPEN_TASK_ERROR,
  renderMergeBaseTaskDescription,
} from "./merge-base-task.js";

describe("renderMergeBaseTaskDescription", () => {
  let previousCwd: string;

  afterEach(() => {
    if (previousCwd) process.chdir(previousCwd);
  });

  it("renders storyId and branchName into the body", () => {
    const body = renderMergeBaseTaskDescription({
      storyId: "my-story",
      branchName: "feat/story-branch",
      mergeBase: "develop",
    });

    expect(body).toContain("feat/story-branch");
    expect(body).toContain("issue story get my-story mergeBaseRef");
    expect(body).not.toMatch(/\{\{/);
  });

  it("names mergeBaseRef get, merges the printed ref, and stops on a failed get", () => {
    const body = renderMergeBaseTaskDescription({
      storyId: "catch-up-story",
      branchName: "feat/story-branch",
      mergeBase: "main",
    });
    const normalized = body.replace(/\s+/g, " ");

    expect(normalized).toContain("issue story get catch-up-story mergeBaseRef");
    expect(normalized).toMatch(/When it prints a ref, merge that ref into/i);
    expect(normalized).toContain("git merge --no-commit");
    expect(normalized).toMatch(
      /issue story set catch-up-story needsAttention true --reason "mergeBaseRef get failed"/,
    );
    expect(normalized).toMatch(/and stop\. Do not merge\./i);
  });

  it("keeps dialog and helper copy on the derived merge-base name", () => {
    expect(mergeBaseHelper("main @ c4d91e2", "story/stack-rebase-helper")).toBe(
      "Appends one predefined task to merge main @ c4d91e2 into story/stack-rebase-helper and reconcile conflicts.",
    );
  });

  it("states the discernable bar, partial resolution, attention stop, and resume rule", () => {
    const body = renderMergeBaseTaskDescription({
      storyId: "s",
      branchName: "feat/story-branch",
      mergeBase: "main",
    });
    const normalized = body.replace(/\s+/g, " ");

    expect(normalized).toContain("git merge --no-commit");
    expect(normalized).toMatch(/discernable only when it is source text/i);
    expect(normalized).toMatch(/not discernable/i);
    expect(normalized).toMatch(/Resolve every discernable path and `git add` it/i);
    expect(normalized).toMatch(/Leave every path that is not discernable unmerged/i);
    expect(normalized).toMatch(/stop before record-commit/i);
    expect(normalized).toMatch(/needsAttention true/);
    expect(normalized).toMatch(/Do not abort the merge/i);
    expect(normalized).toMatch(/resumed after attention is cleared/i);
    expect(normalized).toMatch(/do not take another autonomous pass on them/i);
    expect(normalized).toMatch(/do not re-judge the resolutions/i);
    expect(normalized).toMatch(
      /When every conflicted path was discernable, do not raise attention/i,
    );
  });

  it("reads the template relative to the module, not process.cwd()", () => {
    previousCwd = process.cwd();
    const otherDir = mkdtempSync(join(tmpdir(), "issue-tracker-merge-base-cwd-"));
    process.chdir(otherDir);

    const body = renderMergeBaseTaskDescription({
      storyId: "merge-base-update-action",
      branchName: "merge-base-update-action",
      mergeBase: "main",
    });

    expect(body).toContain("merge-base-update-action");
    expect(body).toContain("issue story get merge-base-update-action mergeBaseRef");

    rmSync(otherDir, { recursive: true, force: true });
  });

  it("fails when storyId is missing instead of emitting a placeholder", () => {
    expect(() =>
      renderMergeBaseTaskDescription({
        storyId: "",
        branchName: "feat/story",
        mergeBase: "main",
      }),
    ).toThrow(IssueError);
    expect(() =>
      renderMergeBaseTaskDescription({
        storyId: "",
        branchName: "feat/story",
        mergeBase: "main",
      }),
    ).toThrow(/storyId/);
  });

  it("fails when branchName is missing instead of emitting a placeholder", () => {
    expect(() =>
      renderMergeBaseTaskDescription({
        storyId: "s",
        branchName: "",
        mergeBase: "main",
      }),
    ).toThrow(IssueError);
    expect(() =>
      renderMergeBaseTaskDescription({
        storyId: "s",
        branchName: "",
        mergeBase: "main",
      }),
    ).toThrow(/branchName/);
  });

  it("fails when mergeBase is missing instead of emitting a placeholder", () => {
    expect(() =>
      renderMergeBaseTaskDescription({
        storyId: "s",
        branchName: "feat/story",
        mergeBase: "",
      }),
    ).toThrow(IssueError);
    expect(() =>
      renderMergeBaseTaskDescription({
        storyId: "s",
        branchName: "feat/story",
        mergeBase: "",
      }),
    ).toThrow(/mergeBase/);
  });
});

const GIT = [
  "-c",
  "user.name=test",
  "-c",
  "user.email=test@example.com",
  "-c",
  "commit.gpgsign=false",
];

function fakeChildProcess(): ChildProcessWithoutNullStreams {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const stdio: ChildProcessWithoutNullStreams["stdio"] = [
    stdin,
    stdout,
    stderr,
    undefined,
    undefined,
  ];
  return Object.assign(new ChildProcess(), { stdin, stdout, stderr, stdio });
}

function git(repo: string, args: string[]): void {
  execFileSync("git", [...GIT, ...args], {
    cwd: repo,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function initRepo(): string {
  const repo = mkdtempSync(join(dir, "repo-"));
  git(repo, ["init", "-b", "main"]);
  writeFileSync(join(repo, "README"), "seed\n");
  git(repo, ["add", "README"]);
  git(repo, ["commit", "-m", "initial"]);
  return repo;
}

function commitFile(repo: string, name: string, message: string): void {
  writeFileSync(join(repo, name), `${message}\n`);
  git(repo, ["add", name]);
  git(repo, ["commit", "-m", message]);
}

function seedStory(worktreePath: string | undefined, branchName?: string): void {
  writeIssue("p", {
    kind: "project",
    title: "P",
    createdAt: nextAt(),
    updatedAt: nextAt(),
  });
  writeIssue("s", {
    kind: "story",
    title: "Story",
    partOf: "p",
    merged: false,
    ...(branchName ? { branchName } : {}),
    ...(worktreePath ? { worktreePath } : {}),
    createdAt: nextAt(),
    updatedAt: nextAt(),
  });
}

async function getBehind(): Promise<{ stdout: string; stderr: string; status: number }> {
  return runIssueCli(["story", "get", "s", "behindMergeBase"], { env: env() });
}

describe("behindMergeBase", () => {
  useCliTestFixtures();

  it("is true when the story tip is an ancestor of the merge-base tip", async () => {
    const repo = initRepo();
    git(repo, ["branch", "feat/story"]);
    commitFile(repo, "ahead", "main moved");
    seedStory(repo, "feat/story");

    const result = await getBehind();
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("true\n");
    expect(JSON.parse(readFileSync(join(dir, "s", "issue.json"), "utf8")).behindMergeBase).toBeUndefined();
  });

  it("is true when the histories have diverged", async () => {
    const repo = initRepo();
    git(repo, ["branch", "feat/story"]);
    commitFile(repo, "on-main", "main moved");
    git(repo, ["checkout", "feat/story"]);
    commitFile(repo, "on-story", "story moved");
    seedStory(repo, "feat/story");

    const result = await getBehind();
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("true\n");
  });

  it("is false when the story branch already contains the merge-base tip", async () => {
    const repo = initRepo();
    git(repo, ["checkout", "-b", "feat/story"]);
    commitFile(repo, "on-story", "story moved");
    seedStory(repo, "feat/story");

    const result = await getBehind();
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("false\n");
  });

  it("fails loudly when the worktree cannot be read", async () => {
    seedStory(join(dir, "missing-worktree"), "feat/story");

    const result = await getBehind();
    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain(BEHIND_MERGE_BASE_NO_WORKTREE_ERROR("s"));
    expect(result.stdout).not.toContain("false");
  });

  it("fails loudly when git cannot read the worktree", async () => {
    const unreadable = mkdtempSync(join(dir, "not-a-repo-"));
    seedStory(unreadable, "feat/story");

    const result = await getBehind();
    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr.length).toBeGreaterThan(0);
    expect(result.stdout).not.toContain("false");
  });

  it("is false when the branch contains origin/main but not local main", async () => {
    const repo = initRepo();
    const bare = mkdtempSync(join(dir, "bare-"));
    git(bare, ["init", "--bare", "-b", "main"]);
    git(repo, ["remote", "add", "origin", bare]);
    git(repo, ["push", "origin", "main"]);
    git(repo, ["checkout", "-b", "feat/story"]);
    commitFile(repo, "story-work", "story commit");
    git(repo, ["checkout", "main"]);
    commitFile(repo, "local-main", "local main moved");
    seedStory(repo, "feat/story");

    const result = await getBehind();
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("false\n");

    rmSync(bare, { recursive: true, force: true });
  });

  it("fails loudly when origin fetch is unreachable", async () => {
    const repo = initRepo();
    git(repo, ["remote", "add", "origin", "git@example.com:org/repo.git"]);
    seedStory(repo, "feat/story");

    setGitWriteSpawnerForTests((command, args, options) => {
      if (args[0] === "fetch") {
        const child = fakeChildProcess();
        setImmediate(() => {
          child.stderr.emit(
            "data",
            "fatal: Could not read from remote repository.",
          );
          child.emit("close", 128);
        });
        return child;
      }
      return spawn(command, args, {
        ...options,
        stdio: ["ignore", "pipe", "pipe"],
      });
    });

    const result = await getBehind();
    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr.length).toBeGreaterThan(0);

    setGitWriteSpawnerForTests(null);
  });
});

afterEach(() => {
  setGitWriteSpawnerForTests(null);
});

describe("update-from-merge-base open task", () => {
  useCliTestFixtures();

  function seedOpenStory(): void {
    writeIssue("p", {
      kind: "project",
      title: "P",
      createdAt: nextAt(),
      updatedAt: nextAt(),
    });
    writeIssue("s", {
      kind: "story",
      title: "Story",
      partOf: "p",
      merged: false,
      branchName: "feat/story",
      createdAt: nextAt(),
      updatedAt: nextAt(),
    });
  }

  it("refuses the command while an update task is not done", async () => {
    seedOpenStory();
    writeIssue("open-update", {
      kind: "task",
      title: "Update from merge base",
      partOf: "s",
      status: "todo",
      order: 0,
      createdAt: nextAt(),
      updatedAt: nextAt(),
    });

    const result = await runIssueCli(["story", "update-from-merge-base", "s"], {
      env: env(),
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(UPDATE_FROM_MERGE_BASE_OPEN_TASK_ERROR("s"));
    expect(existsSync(join(dir, "update-from-merge-base"))).toBe(false);
    expect(
      JSON.parse(readFileSync(join(dir, "open-update", "issue.json"), "utf8")).status,
    ).toBe("todo");
  });

  it("appends a new task after that task is done", async () => {
    seedOpenStory();
    writeIssue("open-update", {
      kind: "task",
      title: "Update from merge base",
      partOf: "s",
      status: "done",
      order: 0,
      createdAt: nextAt(),
      updatedAt: nextAt(),
    });

    const result = await runIssueCli(["story", "update-from-merge-base", "s"], {
      env: env(),
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/created: 1 \(update-from-merge-base\)/);
    expect(existsSync(join(dir, "update-from-merge-base", "issue.json"))).toBe(true);
    expect(
      JSON.parse(readFileSync(join(dir, "open-update", "issue.json"), "utf8")).status,
    ).toBe("done");
  });
});
