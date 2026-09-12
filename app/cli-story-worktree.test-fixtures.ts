import { execFileSync } from "child_process";
import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, expect } from "vitest";
import { runIssueCli } from "./cli-program.js";
import {
  conversationsRoot,
  dir,
  env,
  nextAt,
  useCliTestFixtures,
  writeIssue,
} from "./cli.test-helpers.js";
import { refreshStorePathsFromEnv } from "./server/config.js";
import {
  setGitWriteSpawnerForTests,
  type GitWriteSpawner,
} from "./server/services/git-write.js";
import { WORKTREE_ROOT } from "./server/worktree-constants.js";
import { worktreePathFor } from "./server/services/worktree.js";

const GIT = [
  "-c",
  "user.name=test",
  "-c",
  "user.email=test@example.com",
  "-c",
  "commit.gpgsign=false",
];

export function git(repo: string, args: string[]): string {
  return execFileSync("git", [...GIT, ...args], {
    cwd: repo,
    encoding: "utf8",
  }).trim();
}

export function initRepo(opts?: { gitignore?: string }): string {
  const repo = mkdtempSync(join(tmpdir(), "issue-wt-repo-"));
  git(repo, ["init", "-b", "main"]);
  writeFileSync(join(repo, "README"), "seed\n");
  if (opts?.gitignore) {
    writeFileSync(join(repo, ".gitignore"), opts.gitignore);
    git(repo, ["add", "README", ".gitignore"]);
  } else {
    git(repo, ["add", "README"]);
  }
  git(repo, ["commit", "-m", "initial"]);
  return repo;
}

export function seedImplementingSession(
  convId: string,
  storyId: string,
  projectId: string,
  opts?: { live?: boolean },
): void {
  const convDir = join(conversationsRoot(), convId);
  mkdirSync(convDir, { recursive: true });
  const now = nextAt();
  writeFileSync(
    join(convDir, "meta.json"),
    JSON.stringify({
      id: convId,
      title: "Implement",
      projectId,
      model: "auto",
      issueId: storyId,
      channel: "implementing",
      createdAt: now,
      updatedAt: now,
    }),
  );
  if (opts?.live) {
    writeFileSync(
      join(convDir, "run-live.json"),
      `${JSON.stringify({ pid: process.pid })}\n`,
    );
  }
}

export function writeStory(id: string, extra: Record<string, unknown> = {}): void {
  writeIssue(id, {
    kind: "story",
    title: id,
    partOf: "e",
    merged: false,
    createdAt: nextAt(),
    updatedAt: nextAt(),
    ...extra,
  });
}

const trackedWorktrees: { workspace: string; path: string }[] = [];

export function trackWorktree(
  workspace: string,
  projectId: string,
  storyId: string,
): string {
  const path = worktreePathFor(projectId, storyId);
  trackedWorktrees.push({ workspace, path });
  return path;
}

export function removeTrackedWorktrees(): void {
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
  rmSync(join(WORKTREE_ROOT, "p", ".setup-logs"), { recursive: true, force: true });
}

export function seedProject(workspace?: string, setupCommand?: string): void {
  writeIssue("p", {
    kind: "project",
    title: "Proj",
    ...(workspace ? { workspace } : {}),
    ...(setupCommand ? { setupCommand } : {}),
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

export function failGitWorktreeRemove(): void {
  const spawner: GitWriteSpawner = () => {
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
    };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    setImmediate(() => {
      child.stderr.emit("data", "fatal: fake worktree remove failure\n");
      child.emit("close", 1);
    });
    return child as ReturnType<GitWriteSpawner>;
  };
  setGitWriteSpawnerForTests(spawner);
}

export async function withIssuesDir<T>(fn: () => Promise<T>): Promise<T> {
  const saved = process.env.ISSUES_DIR;
  process.env.ISSUES_DIR = dir;
  refreshStorePathsFromEnv();
  try {
    return await fn();
  } finally {
    if (saved === undefined) delete process.env.ISSUES_DIR;
    else process.env.ISSUES_DIR = saved;
    refreshStorePathsFromEnv();
  }
}

export async function createCleanWorktree(): Promise<string> {
  const workspace = initRepo();
  seedProject(workspace);
  writeStory("a");
  const path = trackWorktree(workspace, "p", "a");
  expect(
    (await runIssueCli(["story", "worktree", "create", "a"], { env: env() })).status,
  ).toBe(0);
  return path;
}

export function useStoryWorktreeCliFixtures(): void {
  useCliTestFixtures();
  afterEach(() => {
    setGitWriteSpawnerForTests(null);
    removeTrackedWorktrees();
    rmSync(conversationsRoot(), { recursive: true, force: true });
  });
}
