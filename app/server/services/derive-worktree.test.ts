import { execFileSync } from "child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runIssueCli } from "../../cli-program.js";
import { setupLogPathFor, WORKTREE_ROOT } from "../worktree-constants.js";
import type { ProjectStoryWorktree } from "../schemas.js";

const AT = "2026-07-09T14:00:00.000Z";
const GIT = [
  "-c",
  "user.name=test",
  "-c",
  "user.email=test@example.com",
  "-c",
  "commit.gpgsign=false",
  "-c",
  "protocol.file.allow=always",
];

let dir: string;
const trackedWorktrees: { workspace: string; path: string }[] = [];

function git(repo: string, args: string[]): string {
  return execFileSync("git", [...GIT, ...args], {
    cwd: repo,
    encoding: "utf8",
  }).trim();
}

function initRepo(): string {
  const repo = mkdtempSync(join(dir, "repo-"));
  git(repo, ["init", "-b", "main"]);
  writeFileSync(join(repo, "README"), "seed\n");
  writeFileSync(join(repo, ".gitignore"), "*.ignored\n");
  git(repo, ["add", "README", ".gitignore"]);
  git(repo, ["commit", "-m", "initial"]);
  return repo;
}

function addWorktree(workspace: string, branch: string): string {
  const path = join(dir, `wt-${branch}`);
  git(workspace, ["worktree", "add", "-b", branch, path]);
  trackedWorktrees.push({ workspace, path });
  return path;
}

function initCheckedOutSubmodule(
  workspace: string,
  mountPath: string,
): string {
  const subRepo = mkdtempSync(join(dir, "sub-repo-"));
  git(subRepo, ["init", "-b", "main"]);
  writeFileSync(join(subRepo, "bar.txt"), "sub\n");
  writeFileSync(join(subRepo, ".gitignore"), "*.ignored\n");
  git(subRepo, ["add", "bar.txt", ".gitignore"]);
  git(subRepo, ["commit", "-m", "sub init"]);
  git(workspace, ["submodule", "add", subRepo, mountPath]);
  git(workspace, ["commit", "-m", "add submodule"]);
  return subRepo;
}

function initSubmoduleWorktree(
  branch: string,
  mountPath: string,
): { workspace: string; path: string; subPath: string } {
  const workspace = initRepo();
  initCheckedOutSubmodule(workspace, mountPath);
  const path = addWorktree(workspace, branch);
  git(path, ["submodule", "update", "--init"]);
  return { workspace, path, subPath: join(path, mountPath) };
}

function writeIssue(id: string, body: Record<string, unknown>): void {
  mkdirSync(join(dir, id), { recursive: true });
  writeFileSync(join(dir, id, "issue.json"), JSON.stringify({ id, ...body }));
}

const PROJECT_ID = "derive-wt-p";

function seedProject(extra: Record<string, unknown> = {}): void {
  writeIssue(PROJECT_ID, {
    kind: "project",
    title: "P",
    order: 0,
    createdAt: AT,
    updatedAt: AT,
    ...extra,
  });
  writeIssue("e", {
    kind: "epic",
    title: "E",
    partOf: PROJECT_ID,
    order: 0,
    createdAt: AT,
    updatedAt: AT,
  });
}

function writeStory(id: string, extra: Record<string, unknown> = {}): void {
  writeIssue(id, {
    kind: "story",
    title: id,
    partOf: "e",
    createdAt: AT,
    updatedAt: AT,
    ...extra,
  });
}

async function loadWorktrees() {
  const mod = await import("./derive-worktree.js");
  return mod.loadProjectWorktrees(PROJECT_ID);
}

const QUIET_GIT = {
  dirty: false,
  dirtyPaths: [],
  ahead: 0,
  behind: 0,
};

function worktreeOf(
  worktrees: Record<string, ProjectStoryWorktree>,
  id: string,
): ProjectStoryWorktree {
  const worktree = worktrees[id];
  if (!worktree) throw new Error(`expected worktrees[${id}]`);
  return worktree;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "issue-tracker-derive-wt-"));
  vi.resetModules();
  vi.stubEnv("ISSUES_DIR", dir);
});

afterEach(() => {
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
  rmSync(join(WORKTREE_ROOT, PROJECT_ID, ".setup-logs"), {
    recursive: true,
    force: true,
  });
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

describe("derived worktree", () => {
  it("reports a clean worktree", async () => {
    const workspace = initRepo();
    const path = addWorktree(workspace, "feat-clean");
    seedProject();
    writeStory("s", { branchName: "feat-clean", worktreePath: path });

    expect(worktreeOf((await loadWorktrees()).worktrees, "s")).toEqual({
      ...QUIET_GIT,
      path,
      exists: true,
      uncommittedCount: 0,
      atRiskCommitCount: 0,
      retained: false,
      locked: false,
    });
  });

  it("marks a locked worktree registration", async () => {
    const workspace = initRepo();
    const path = addWorktree(workspace, "feat-locked");
    git(workspace, ["worktree", "lock", path]);
    seedProject({ workspace });
    writeStory("s", { branchName: "feat-locked", worktreePath: path });

    expect(worktreeOf((await loadWorktrees()).worktrees, "s").locked).toBe(true);
    git(workspace, ["worktree", "unlock", path]);
  });

  it("marks a locked registration after the directory is gone", async () => {
    const workspace = initRepo();
    const path = addWorktree(workspace, "feat-locked-gone");
    git(workspace, ["worktree", "lock", path]);
    rmSync(path, { recursive: true, force: true });
    seedProject({ workspace });
    writeStory("s", { branchName: "feat-locked-gone", worktreePath: path });

    const worktree = worktreeOf((await loadWorktrees()).worktrees, "s");
    expect(worktree.exists).toBe(false);
    expect(worktree.locked).toBe(true);
  });

  it("counts a tracked modification", async () => {
    const workspace = initRepo();
    const path = addWorktree(workspace, "feat-mod");
    writeFileSync(join(path, "README"), "changed\n");
    seedProject();
    writeStory("s", { branchName: "feat-mod", worktreePath: path });

    const worktree = worktreeOf((await loadWorktrees()).worktrees, "s");
    expect(worktree.uncommittedCount).toBe(1);
    expect(worktree.dirty).toBe(true);
    expect(worktree.dirtyPaths).toEqual(["README"]);
  });

  it("counts an untracked non-ignored file", async () => {
    const workspace = initRepo();
    const path = addWorktree(workspace, "feat-untracked");
    writeFileSync(join(path, "extra.txt"), "hi\n");
    seedProject();
    writeStory("s", { branchName: "feat-untracked", worktreePath: path });

    expect(worktreeOf((await loadWorktrees()).worktrees, "s").uncommittedCount).toBe(1);
  });

  it("does not count gitignored files", async () => {
    const workspace = initRepo();
    const path = addWorktree(workspace, "feat-ignored");
    writeFileSync(join(path, "secret.ignored"), "nope\n");
    seedProject();
    writeStory("s", { branchName: "feat-ignored", worktreePath: path });

    expect(worktreeOf((await loadWorktrees()).worktrees, "s").uncommittedCount).toBe(0);
  });

  it("counts at-risk commits that are not on trunk", async () => {
    const workspace = initRepo();
    const path = addWorktree(workspace, "feat-risk");
    writeFileSync(join(path, "wip.txt"), "wip\n");
    git(path, ["add", "wip.txt"]);
    git(path, ["commit", "-m", "wip"]);
    seedProject();
    writeStory("s", { branchName: "feat-risk", worktreePath: path });

    const worktree = worktreeOf((await loadWorktrees()).worktrees, "s");
    expect(worktree.atRiskCommitCount).toBe(1);
    expect(worktree.ahead).toBe(1);
    expect(worktree.behind).toBe(0);
    expect(worktree.dirty).toBe(false);
    expect(worktree.upstream).toBeUndefined();
  });

  it("counts zero at-risk commits after the branch is merged to trunk", async () => {
    const workspace = initRepo();
    const path = addWorktree(workspace, "feat-merged");
    writeFileSync(join(path, "wip.txt"), "wip\n");
    git(path, ["add", "wip.txt"]);
    git(path, ["commit", "-m", "wip"]);
    git(workspace, ["merge", "feat-merged"]);
    seedProject();
    writeStory("s", { branchName: "feat-merged", worktreePath: path });

    expect(worktreeOf((await loadWorktrees()).worktrees, "s").atRiskCommitCount).toBe(0);
  });

  it("marks a merged Story whose checkout still exists as retained", async () => {
    const workspace = initRepo();
    const path = addWorktree(workspace, "feat-kept");
    seedProject();
    writeStory("s", {
      branchName: "feat-kept",
      worktreePath: path,
      merged: true,
    });

    const worktree = worktreeOf((await loadWorktrees()).worktrees, "s");
    expect(worktree.exists).toBe(true);
    expect(worktree.retained).toBe(true);
  });

  it("derives a Story with no worktree as absent rather than erroring", async () => {
    seedProject();
    writeStory("s");

    expect(worktreeOf((await loadWorktrees()).worktrees, "s")).toEqual({
      ...QUIET_GIT,
      exists: false,
      uncommittedCount: 0,
      atRiskCommitCount: 0,
      retained: false,
      locked: false,
    });
  });

  it("does not error when the recorded path exists but is not a git checkout", async () => {
    const path = mkdtempSync(join(dir, "nongit-"));
    seedProject();
    writeStory("s", { branchName: "nongit", worktreePath: path });

    expect(worktreeOf((await loadWorktrees()).worktrees, "s")).toEqual({
      ...QUIET_GIT,
      path,
      exists: true,
      uncommittedCount: 0,
      atRiskCommitCount: 0,
      retained: false,
      locked: false,
    });
    rmSync(path, { recursive: true, force: true });
  });

  it("derives a vanished worktree directory as absent rather than erroring", async () => {
    seedProject();
    const missing = join(dir, "missing");
    writeStory("s", {
      branchName: "ghost",
      worktreePath: missing,
    });

    const worktree = worktreeOf((await loadWorktrees()).worktrees, "s");
    expect(worktree.exists).toBe(false);
    expect(worktree.path).toBe(missing);
    expect(worktree.uncommittedCount).toBe(0);
    expect(worktree.atRiskCommitCount).toBe(0);
    expect(worktree.retained).toBe(false);
    expect(worktree.locked).toBe(false);
  });

  it("surfaces the recorded setup failure and blocked reason", async () => {
    const logPath = setupLogPathFor(PROJECT_ID, "s");
    mkdirSync(dirname(logPath), { recursive: true });
    writeFileSync(logPath, "setup failed\n");
    seedProject();
    writeStory("s", {
      worktreeSetupFailed: true,
      worktreeBlockedReason: "parent-branch",
    });

    expect(worktreeOf((await loadWorktrees()).worktrees, "s")).toEqual({
      ...QUIET_GIT,
      exists: false,
      uncommittedCount: 0,
      atRiskCommitCount: 0,
      retained: false,
      locked: false,
      setupFailed: true,
      setupLogPath: logPath,
      setupOutput: "setup failed\n",
      blockedReason: "parent-branch",
    });
  });

  it("excludes commits reachable from the branch upstream", async () => {
    const workspace = initRepo();
    const path = addWorktree(workspace, "feat-upstream");
    writeFileSync(join(path, "wip.txt"), "wip\n");
    git(path, ["add", "wip.txt"]);
    git(path, ["commit", "-m", "wip"]);
    const remote = mkdtempSync(join(dir, "remote-"));
    git(remote, ["init", "--bare"]);
    git(workspace, ["remote", "add", "origin", remote]);
    git(workspace, ["push", "-u", "origin", "feat-upstream"]);
    seedProject();
    writeStory("s", { branchName: "feat-upstream", worktreePath: path });

    const worktree = worktreeOf((await loadWorktrees()).worktrees, "s");
    expect(worktree.atRiskCommitCount).toBe(0);
    expect(worktree.upstream).toBe("origin/feat-upstream");
    expect(worktree.ahead).toBe(0);
    expect(worktree.behind).toBe(0);
    rmSync(remote, { recursive: true, force: true });
  });

  it("marks an archived Story whose checkout still exists as retained", async () => {
    const workspace = initRepo();
    const path = addWorktree(workspace, "feat-archived");
    seedProject();
    writeStory("s", {
      branchName: "feat-archived",
      worktreePath: path,
      archived: true,
    });

    const worktree = worktreeOf((await loadWorktrees()).worktrees, "s");
    expect(worktree.exists).toBe(true);
    expect(worktree.retained).toBe(true);
  });

  it("uses the Project trunk for at-risk reachability", async () => {
    const workspace = initRepo();
    git(workspace, ["branch", "develop"]);
    const path = addWorktree(workspace, "feat-trunk");
    writeFileSync(join(path, "wip.txt"), "wip\n");
    git(path, ["add", "wip.txt"]);
    git(path, ["commit", "-m", "wip"]);
    git(workspace, ["merge", "feat-trunk"]);
    seedProject({ trunk: "develop" });
    writeStory("s", { branchName: "feat-trunk", worktreePath: path });

    expect(worktreeOf((await loadWorktrees()).worktrees, "s").atRiskCommitCount).toBe(1);
  });

  it("does not surface a leftover setup log after a successful setup", async () => {
    const logPath = setupLogPathFor(PROJECT_ID, "s");
    mkdirSync(dirname(logPath), { recursive: true });
    writeFileSync(logPath, "old failure\n");
    seedProject();
    writeStory("s");

    expect(worktreeOf((await loadWorktrees()).worktrees, "s")).toEqual({
      ...QUIET_GIT,
      exists: false,
      uncommittedCount: 0,
      atRiskCommitCount: 0,
      retained: false,
      locked: false,
    });
  });

  it("exposes derived worktree on story get", async () => {
    seedProject();
    writeStory("s");

    const result = await runIssueCli(["story", "get", "s", "worktree"], {
      env: { ISSUES_DIR: dir, ISSUE_TRACKER_SKIP_MODEL_SLUG_SYNC: "1" },
    });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      ...QUIET_GIT,
      exists: false,
      uncommittedCount: 0,
      atRiskCommitCount: 0,
      retained: false,
      locked: false,
    });
  });

  it("counts a parent file change once alongside submodule dirt", async () => {
    const { path, subPath } = initSubmoduleWorktree("feat-parent-file", "libs/foo");
    writeFileSync(join(path, "README"), "parent dirty\n");
    writeFileSync(join(subPath, "bar.txt"), "sub dirty\n");
    seedProject();
    writeStory("s", { branchName: "feat-parent-file", worktreePath: path });

    const worktree = worktreeOf((await loadWorktrees()).worktrees, "s");
    expect(worktree.uncommittedCount).toBe(2);
    expect(worktree.dirtyPaths).toEqual(
      expect.arrayContaining(["README", "libs/foo/bar.txt"]),
    );
    expect(worktree.dirtyPaths).toHaveLength(2);
  });

  it("uses submodule inner porcelain instead of the parent submodule line", async () => {
    const { path, subPath } = initSubmoduleWorktree("feat-sub-inner", "libs/foo");
    writeFileSync(join(subPath, "bar.txt"), "sub dirty\n");
    writeFileSync(join(subPath, "extra.txt"), "new\n");
    seedProject();
    writeStory("s", { branchName: "feat-sub-inner", worktreePath: path });

    expect(worktreeOf((await loadWorktrees()).worktrees, "s").uncommittedCount).toBe(2);
  });

  it("counts the parent submodule line once when inner porcelain is empty", async () => {
    const { path, subPath } = initSubmoduleWorktree("feat-sub-pointer", "libs/foo");
    writeFileSync(join(subPath, "bar.txt"), "sub dirty\n");
    git(subPath, ["add", "bar.txt"]);
    git(subPath, ["commit", "-m", "sub change"]);
    seedProject();
    writeStory("s", { branchName: "feat-sub-pointer", worktreePath: path });

    expect(worktreeOf((await loadWorktrees()).worktrees, "s").uncommittedCount).toBe(1);
  });

  it("applies the once-per-change rule at nested submodule levels", async () => {
    const workspace = initRepo();
    const innerSubRepo = mkdtempSync(join(dir, "inner-sub-"));
    git(innerSubRepo, ["init", "-b", "main"]);
    writeFileSync(join(innerSubRepo, "inner.txt"), "inner\n");
    git(innerSubRepo, ["add", "inner.txt"]);
    git(innerSubRepo, ["commit", "-m", "inner init"]);

    const outerSubRepo = mkdtempSync(join(dir, "outer-sub-"));
    git(outerSubRepo, ["init", "-b", "main"]);
    git(outerSubRepo, ["submodule", "add", innerSubRepo, "nested/inner"]);
    git(outerSubRepo, ["commit", "-m", "outer with inner sub"]);
    git(workspace, ["submodule", "add", outerSubRepo, "libs/outer"]);
    git(workspace, ["commit", "-m", "add nested submodule"]);

    const path = addWorktree(workspace, "feat-nested-sub");
    git(path, ["submodule", "update", "--init", "--recursive"]);
    const outerPath = join(path, "libs/outer");
    const innerPath = join(outerPath, "nested/inner");
    writeFileSync(join(innerPath, "inner.txt"), "nested dirty\n");
    writeFileSync(join(innerPath, "leaf.txt"), "new leaf\n");
    seedProject();
    writeStory("s", { branchName: "feat-nested-sub", worktreePath: path });

    expect(worktreeOf((await loadWorktrees()).worktrees, "s").uncommittedCount).toBe(2);
  });

  it("does not count gitignored files inside a submodule", async () => {
    const { path, subPath } = initSubmoduleWorktree("feat-sub-ignored", "libs/foo");
    writeFileSync(join(subPath, "secret.ignored"), "nope\n");
    seedProject();
    writeStory("s", { branchName: "feat-sub-ignored", worktreePath: path });

    expect(worktreeOf((await loadWorktrees()).worktrees, "s").uncommittedCount).toBe(0);
  });
});
