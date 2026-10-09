import { execFileSync } from "child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WORKTREE_ROOT } from "../worktree-constants.js";
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
});
