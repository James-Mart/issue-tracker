import { execFileSync } from "child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runIssueCli } from "./cli-program.js";
import {
  dir,
  env,
  issueJsonField,
  nextAt,
  useCliTestFixtures,
  writeIssue,
} from "./cli.test-helpers.js";
import { WORKTREE_ROOT } from "./server/worktree-constants.js";
import { worktreePathFor } from "./server/services/worktree.js";

useCliTestFixtures();

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
  const repo = mkdtempSync(join(tmpdir(), "issue-wt-repo-"));
  git(repo, ["init", "-b", "main"]);
  writeFileSync(join(repo, "README"), "seed\n");
  git(repo, ["add", "README"]);
  git(repo, ["commit", "-m", "initial"]);
  return repo;
}

const trackedWorktrees: { workspace: string; path: string }[] = [];

function trackWorktree(workspace: string, projectId: string, storyId: string): string {
  const path = worktreePathFor(projectId, storyId);
  trackedWorktrees.push({ workspace, path });
  return path;
}

function removeTrackedWorktrees(): void {
  for (const { workspace, path } of trackedWorktrees.splice(0)) {
    if (!existsSync(path)) continue;
    try {
      git(workspace, ["worktree", "remove", "--force", path]);
    } catch {
      rmSync(path, { recursive: true, force: true });
      try {
        git(workspace, ["worktree", "prune"]);
      } catch {
        // best-effort cleanup
      }
    }
  }
}

function seedProject(workspace?: string): void {
  writeIssue("p", {
    kind: "project",
    title: "Proj",
    ...(workspace ? { workspace } : {}),
    createdAt: nextAt(),
    updatedAt: nextAt(),
  });
  writeIssue("e", {
    kind: "epic",
    title: "Epic",
    partOf: "p",
    blockedBy: [],
    createdAt: nextAt(),
    updatedAt: nextAt(),
  });
}

afterEach(() => {
  removeTrackedWorktrees();
});

describe("story worktree create", () => {
  it("creates a worktree off trunk for a root-level Story", async () => {
    const workspace = initRepo();
    seedProject(workspace);
    writeIssue("root-story", {
      kind: "story",
      title: "Root",
      partOf: "e",
      merged: false,
      createdAt: nextAt(),
      updatedAt: nextAt(),
    });

    const expectedPath = trackWorktree(workspace, "p", "root-story");
    const result = await runIssueCli(["story", "worktree", "create", "root-story"], {
      env: env(),
    });
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(expectedPath);
    expect(existsSync(expectedPath)).toBe(true);
    expect(issueJsonField("root-story", "worktreePath")).toBe(expectedPath);
    expect(issueJsonField("root-story", "worktreeBlockedReason")).toBeUndefined();
    expect(git(expectedPath, ["rev-parse", "--abbrev-ref", "HEAD"])).toBe("root-story");
  });

  it("creates a worktree off the parent branch for a stacked Story", async () => {
    const workspace = initRepo();
    seedProject(workspace);
    writeIssue("parent", {
      kind: "story",
      title: "Parent",
      partOf: "e",
      branchName: "parent",
      merged: false,
      createdAt: nextAt(),
      updatedAt: nextAt(),
    });
    git(workspace, ["branch", "parent"]);
    writeIssue("child", {
      kind: "story",
      title: "Child",
      partOf: "e",
      stackedOn: "parent",
      merged: false,
      createdAt: nextAt(),
      updatedAt: nextAt(),
    });

    const expectedPath = trackWorktree(workspace, "p", "child");
    const result = await runIssueCli(["story", "worktree", "create", "child"], {
      env: env(),
    });
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(expectedPath);
    expect(git(expectedPath, ["merge-base", "HEAD", "parent"])).toBe(
      git(workspace, ["rev-parse", "parent"]),
    );
  });

  it("refuses when mergeBase is unset, records worktreeBlockedReason, and clears it on success", async () => {
    const workspace = initRepo();
    seedProject(workspace);
    writeIssue("parent", {
      kind: "story",
      title: "Parent",
      partOf: "e",
      merged: false,
      createdAt: nextAt(),
      updatedAt: nextAt(),
    });
    writeIssue("child", {
      kind: "story",
      title: "Child",
      partOf: "e",
      stackedOn: "parent",
      merged: false,
      createdAt: nextAt(),
      updatedAt: nextAt(),
    });

    const refused = await runIssueCli(["story", "worktree", "create", "child"], {
      env: env(),
    });
    expect(refused.status).not.toBe(0);
    expect(refused.stderr).toMatch(/stacked on Story "parent" which has no branch yet/);
    expect(issueJsonField("child", "worktreeBlockedReason")).toBe("parent-branch");
    expect(existsSync(worktreePathFor("p", "child"))).toBe(false);

    await runIssueCli(["story", "set", "parent", "branchName", "parent"], { env: env() });
    git(workspace, ["branch", "parent"]);

    const expectedPath = worktreePathFor("p", "child");
    trackedWorktrees.push({ workspace, path: expectedPath });
    const created = await runIssueCli(["story", "worktree", "create", "child"], {
      env: env(),
    });
    expect(created.status).toBe(0);
    expect(issueJsonField("child", "worktreeBlockedReason")).toBeUndefined();
  });

  it("refuses when branchName is already set", async () => {
    const workspace = initRepo();
    seedProject(workspace);
    writeIssue("a", {
      kind: "story",
      title: "A",
      partOf: "e",
      branchName: "feat/a",
      merged: false,
      createdAt: nextAt(),
      updatedAt: nextAt(),
    });

    const result = await runIssueCli(["story", "worktree", "create", "a"], { env: env() });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/already has branchName/);
  });

  it("refuses when worktreePath already exists on disk", async () => {
    const workspace = initRepo();
    seedProject(workspace);
    writeIssue("a", {
      kind: "story",
      title: "A",
      partOf: "e",
      merged: false,
      createdAt: nextAt(),
      updatedAt: nextAt(),
    });

    const path = trackWorktree(workspace, "p", "a");
    mkdirSync(path, { recursive: true });
    writeIssue("a", {
      kind: "story",
      title: "A",
      partOf: "e",
      worktreePath: path,
      merged: false,
      createdAt: nextAt(),
      updatedAt: nextAt(),
    });

    const result = await runIssueCli(["story", "worktree", "create", "a"], { env: env() });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/already has a worktree at/);
  });

  it("refuses when the Project has no workspace", async () => {
    seedProject();
    writeIssue("a", {
      kind: "story",
      title: "A",
      partOf: "e",
      merged: false,
      createdAt: nextAt(),
      updatedAt: nextAt(),
    });

    const result = await runIssueCli(["story", "worktree", "create", "a"], { env: env() });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/Project workspace is not set/);
  });
});

describe("story worktree attach", () => {
  it("attaches a worktree while the Project workspace stays on trunk", async () => {
    const workspace = initRepo();
    seedProject(workspace);
    git(workspace, ["branch", "feat/a"]);
    writeIssue("a", {
      kind: "story",
      title: "A",
      partOf: "e",
      branchName: "feat/a",
      merged: false,
      createdAt: nextAt(),
      updatedAt: nextAt(),
    });

    const expectedPath = trackWorktree(workspace, "p", "a");
    const result = await runIssueCli(["story", "worktree", "attach", "a"], { env: env() });
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(expectedPath);
    expect(git(workspace, ["rev-parse", "--abbrev-ref", "HEAD"])).toBe("main");
    expect(git(expectedPath, ["rev-parse", "--abbrev-ref", "HEAD"])).toBe("feat/a");
  });

  it("clears worktreeBlockedReason on attach", async () => {
    const workspace = initRepo();
    seedProject(workspace);
    git(workspace, ["branch", "feat/a"]);
    writeIssue("a", {
      kind: "story",
      title: "A",
      partOf: "e",
      branchName: "feat/a",
      worktreeBlockedReason: "parent-branch",
      merged: false,
      createdAt: nextAt(),
      updatedAt: nextAt(),
    });

    trackWorktree(workspace, "p", "a");
    const result = await runIssueCli(["story", "worktree", "attach", "a"], { env: env() });
    expect(result.status).toBe(0);
    expect(issueJsonField("a", "worktreeBlockedReason")).toBeUndefined();
  });

  it("refuses when branchName is unset", async () => {
    const workspace = initRepo();
    seedProject(workspace);
    writeIssue("a", {
      kind: "story",
      title: "A",
      partOf: "e",
      merged: false,
      createdAt: nextAt(),
      updatedAt: nextAt(),
    });

    const result = await runIssueCli(["story", "worktree", "attach", "a"], { env: env() });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/requires branchName/);
  });

  it("refuses when the branch does not exist in the repository", async () => {
    const workspace = initRepo();
    seedProject(workspace);
    writeIssue("a", {
      kind: "story",
      title: "A",
      partOf: "e",
      branchName: "missing-branch",
      merged: false,
      createdAt: nextAt(),
      updatedAt: nextAt(),
    });

    const result = await runIssueCli(["story", "worktree", "attach", "a"], { env: env() });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/does not exist in the Project repository/);
  });

  it("refuses when the Project workspace is on the Story branch", async () => {
    const workspace = initRepo();
    seedProject(workspace);
    git(workspace, ["branch", "feat/a"]);
    git(workspace, ["checkout", "feat/a"]);
    writeIssue("a", {
      kind: "story",
      title: "A",
      partOf: "e",
      branchName: "feat/a",
      merged: false,
      createdAt: nextAt(),
      updatedAt: nextAt(),
    });

    const result = await runIssueCli(["story", "worktree", "attach", "a"], { env: env() });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/checked out in the Project workspace/);

    git(workspace, ["checkout", "main"]);
  });

  it("refuses when worktreePath already exists on disk", async () => {
    const workspace = initRepo();
    seedProject(workspace);
    git(workspace, ["branch", "feat/a"]);
    const path = trackWorktree(workspace, "p", "a");
    mkdirSync(path, { recursive: true });
    writeIssue("a", {
      kind: "story",
      title: "A",
      partOf: "e",
      branchName: "feat/a",
      worktreePath: path,
      merged: false,
      createdAt: nextAt(),
      updatedAt: nextAt(),
    });

    const result = await runIssueCli(["story", "worktree", "attach", "a"], { env: env() });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/already has a worktree at/);
  });

  it("refuses when the Project has no workspace", async () => {
    seedProject();
    writeIssue("a", {
      kind: "story",
      title: "A",
      partOf: "e",
      branchName: "feat/a",
      merged: false,
      createdAt: nextAt(),
      updatedAt: nextAt(),
    });

    const result = await runIssueCli(["story", "worktree", "attach", "a"], { env: env() });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/Project workspace is not set/);
  });
});

describe("story worktree path namespace", () => {
  it("uses the fixed tracker root", () => {
    expect(worktreePathFor("my-proj", "my-story")).toBe(
      join(WORKTREE_ROOT, "my-proj", "my-story"),
    );
  });
});
