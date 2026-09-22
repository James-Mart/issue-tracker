import { execFileSync } from "child_process";
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
  BEHIND_MERGE_BASE_NO_WORKTREE_ERROR,
  UPDATE_FROM_MERGE_BASE_OPEN_TASK_ERROR,
  renderMergeBaseTaskDescription,
} from "./merge-base-task.js";

describe("renderMergeBaseTaskDescription", () => {
  let previousCwd: string;

  afterEach(() => {
    if (previousCwd) process.chdir(previousCwd);
  });

  it("renders both branchName and mergeBase into the body", () => {
    const body = renderMergeBaseTaskDescription({
      branchName: "feat/story-branch",
      mergeBase: "develop",
    });

    expect(body).toContain("feat/story-branch");
    expect(body).toContain("develop");
    expect(body).not.toMatch(/\{\{/);
  });

  it("reads the template relative to the module, not process.cwd()", () => {
    previousCwd = process.cwd();
    const otherDir = mkdtempSync(join(tmpdir(), "issue-tracker-merge-base-cwd-"));
    process.chdir(otherDir);

    const body = renderMergeBaseTaskDescription({
      branchName: "merge-base-update-action",
      mergeBase: "main",
    });

    expect(body).toContain("merge-base-update-action");
    expect(body).toContain("main");

    rmSync(otherDir, { recursive: true, force: true });
  });

  it("fails when branchName is missing instead of emitting a placeholder", () => {
    expect(() =>
      renderMergeBaseTaskDescription({ branchName: "", mergeBase: "main" }),
    ).toThrow(IssueError);
    expect(() =>
      renderMergeBaseTaskDescription({ branchName: "", mergeBase: "main" }),
    ).toThrow(/branchName/);
  });

  it("fails when mergeBase is missing instead of emitting a placeholder", () => {
    expect(() =>
      renderMergeBaseTaskDescription({
        branchName: "feat/story",
        mergeBase: "",
      }),
    ).toThrow(IssueError);
    expect(() =>
      renderMergeBaseTaskDescription({
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
