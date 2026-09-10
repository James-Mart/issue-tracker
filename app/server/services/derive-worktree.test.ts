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
import type { DerivedWorktree } from "../schemas.js";

const AT = "2026-07-09T14:00:00.000Z";
const GIT = [
  "-c",
  "user.name=test",
  "-c",
  "user.email=test@example.com",
  "-c",
  "commit.gpgsign=false",
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

async function loadList() {
  const mod = await import("./issues.js");
  return mod.list;
}

function worktreeOf(
  derived: Record<string, { worktree?: DerivedWorktree }>,
  id: string,
): DerivedWorktree {
  const worktree = derived[id]?.worktree;
  if (!worktree) throw new Error(`expected derived[${id}].worktree`);
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

describe("derived worktree on list()", () => {
  it("reports a clean worktree", async () => {
    const workspace = initRepo();
    const path = addWorktree(workspace, "feat-clean");
    seedProject();
    writeStory("s", { branchName: "feat-clean", worktreePath: path });

    const list = await loadList();
    expect(worktreeOf(list().derived, "s")).toEqual({
      path,
      exists: true,
      uncommittedCount: 0,
      atRiskCommitCount: 0,
      retained: false,
    });
  });

  it("counts a tracked modification", async () => {
    const workspace = initRepo();
    const path = addWorktree(workspace, "feat-mod");
    writeFileSync(join(path, "README"), "changed\n");
    seedProject();
    writeStory("s", { branchName: "feat-mod", worktreePath: path });

    const list = await loadList();
    expect(worktreeOf(list().derived, "s").uncommittedCount).toBe(1);
  });

  it("counts an untracked non-ignored file", async () => {
    const workspace = initRepo();
    const path = addWorktree(workspace, "feat-untracked");
    writeFileSync(join(path, "extra.txt"), "hi\n");
    seedProject();
    writeStory("s", { branchName: "feat-untracked", worktreePath: path });

    const list = await loadList();
    expect(worktreeOf(list().derived, "s").uncommittedCount).toBe(1);
  });

  it("does not count gitignored files", async () => {
    const workspace = initRepo();
    const path = addWorktree(workspace, "feat-ignored");
    writeFileSync(join(path, "secret.ignored"), "nope\n");
    seedProject();
    writeStory("s", { branchName: "feat-ignored", worktreePath: path });

    const list = await loadList();
    expect(worktreeOf(list().derived, "s").uncommittedCount).toBe(0);
  });

  it("counts at-risk commits that are not on trunk", async () => {
    const workspace = initRepo();
    const path = addWorktree(workspace, "feat-risk");
    writeFileSync(join(path, "wip.txt"), "wip\n");
    git(path, ["add", "wip.txt"]);
    git(path, ["commit", "-m", "wip"]);
    seedProject();
    writeStory("s", { branchName: "feat-risk", worktreePath: path });

    const list = await loadList();
    expect(worktreeOf(list().derived, "s").atRiskCommitCount).toBe(1);
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

    const list = await loadList();
    expect(worktreeOf(list().derived, "s").atRiskCommitCount).toBe(0);
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

    const list = await loadList();
    const worktree = worktreeOf(list().derived, "s");
    expect(worktree.exists).toBe(true);
    expect(worktree.retained).toBe(true);
  });

  it("derives a Story with no worktree as absent rather than erroring", async () => {
    seedProject();
    writeStory("s");

    const list = await loadList();
    expect(worktreeOf(list().derived, "s")).toEqual({
      exists: false,
      uncommittedCount: 0,
      atRiskCommitCount: 0,
      retained: false,
    });
  });

  it("does not error when the recorded path exists but is not a git checkout", async () => {
    const path = mkdtempSync(join(dir, "nongit-"));
    seedProject();
    writeStory("s", { branchName: "nongit", worktreePath: path });

    const list = await loadList();
    expect(worktreeOf(list().derived, "s")).toEqual({
      path,
      exists: true,
      uncommittedCount: 0,
      atRiskCommitCount: 0,
      retained: false,
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

    const list = await loadList();
    const worktree = worktreeOf(list().derived, "s");
    expect(worktree.exists).toBe(false);
    expect(worktree.path).toBe(missing);
    expect(worktree.uncommittedCount).toBe(0);
    expect(worktree.atRiskCommitCount).toBe(0);
    expect(worktree.retained).toBe(false);
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

    const list = await loadList();
    expect(worktreeOf(list().derived, "s")).toEqual({
      exists: false,
      uncommittedCount: 0,
      atRiskCommitCount: 0,
      retained: false,
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

    const list = await loadList();
    expect(worktreeOf(list().derived, "s").atRiskCommitCount).toBe(0);
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

    const list = await loadList();
    const worktree = worktreeOf(list().derived, "s");
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

    const list = await loadList();
    expect(worktreeOf(list().derived, "s").atRiskCommitCount).toBe(1);
  });

  it("does not surface a leftover setup log after a successful setup", async () => {
    const logPath = setupLogPathFor(PROJECT_ID, "s");
    mkdirSync(dirname(logPath), { recursive: true });
    writeFileSync(logPath, "old failure\n");
    seedProject();
    writeStory("s");

    const list = await loadList();
    expect(worktreeOf(list().derived, "s")).toEqual({
      exists: false,
      uncommittedCount: 0,
      atRiskCommitCount: 0,
      retained: false,
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
      exists: false,
      uncommittedCount: 0,
      atRiskCommitCount: 0,
      retained: false,
    });
  });
});
