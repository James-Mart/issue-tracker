import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import type { Server } from "http";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WORKTREE_ROOT } from "../worktree-constants.js";
import { setupLogPathFor, worktreePathFor } from "../services/worktree.js";

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
let server: Server;
let baseUrl: string;
let workspace: string;
const trackedWorktrees: { workspace: string; path: string }[] = [];
let gitRemoveCalls: string[][] = [];
let setGitWriteSpawnerForTests: (
  next: import("../services/git-write.js").GitWriteSpawner | null,
) => void;

function git(repo: string, args: string[]): string {
  return execFileSync("git", [...GIT, ...args], {
    cwd: repo,
    encoding: "utf8",
  }).trim();
}

function initRepo(): string {
  const repo = mkdtempSync(join(tmpdir(), "issue-wt-route-repo-"));
  git(repo, ["init", "-b", "main"]);
  writeFileSync(join(repo, "README"), "seed\n");
  git(repo, ["add", "README"]);
  git(repo, ["commit", "-m", "initial"]);
  return repo;
}

function writeIssue(id: string, body: Record<string, unknown>): void {
  mkdirSync(join(dir, id), { recursive: true });
  writeFileSync(join(dir, id, "issue.json"), JSON.stringify({ id, ...body }));
}

function readStoryJson(id: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(dir, id, "issue.json"), "utf8"));
}

function trackWorktree(ws: string, projectId: string, storyId: string): string {
  const path = worktreePathFor(projectId, storyId);
  trackedWorktrees.push({ workspace: ws, path });
  return path;
}

function removeTrackedWorktrees(): void {
  for (const { workspace: ws, path } of trackedWorktrees.splice(0)) {
    if (!existsSync(path)) continue;
    try {
      git(ws, ["worktree", "remove", "--force", path]);
    } catch {
      rmSync(path, { recursive: true, force: true });
      try {
        git(ws, ["worktree", "prune"]);
      } catch {
        // best-effort cleanup
      }
    }
  }
  rmSync(join(WORKTREE_ROOT, "p", ".setup-logs"), { recursive: true, force: true });
}

function seedProject(setupCommand?: string): void {
  writeIssue("p", {
    kind: "project",
    title: "Proj",
    workspace,
    ...(setupCommand ? { setupCommand } : {}),
    order: 0,
    createdAt: AT,
    updatedAt: AT,
  });
  writeIssue("e", {
    kind: "epic",
    title: "Epic",
    partOf: "p",
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
    merged: false,
    order: 0,
    createdAt: AT,
    updatedAt: AT,
    ...extra,
  });
}

async function createWorktree(storyId: string): Promise<string> {
  const path = trackWorktree(workspace, "p", storyId);
  git(workspace, ["worktree", "add", "-b", storyId, path, "main"]);
  writeStory(storyId, { worktreePath: path });
  return path;
}

async function postRemove(
  id: string,
  body: unknown = {},
): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`${baseUrl}/api/issues/${id}/worktree/remove`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json =
    res.status === 204 ? null : await res.json().catch(() => null);
  return { status: res.status, json };
}

async function postSetup(
  id: string,
): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`${baseUrl}/api/issues/${id}/worktree/setup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  const json =
    res.status === 204 ? null : await res.json().catch(() => null);
  return { status: res.status, json };
}

function recordGitRemoveCalls(): void {
  gitRemoveCalls = [];
  setGitWriteSpawnerForTests((command, args, options) => {
    if (args[0] === "worktree" && args[1] === "remove") {
      gitRemoveCalls.push([...args]);
    }
    return spawn(command, args, {
      ...options,
      stdio: ["ignore", "pipe", "pipe"],
    });
  });
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "issue-wt-routes-"));
  workspace = initRepo();
  gitRemoveCalls = [];
  vi.resetModules();
  vi.stubEnv("ISSUES_DIR", dir);

  seedProject("touch SETUP_OK");

  ({ setGitWriteSpawnerForTests } = await import("../services/git-write.js"));
  const { createApp } = await import("../app.js");
  const app = createApp();
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address();
  if (!addr || typeof addr === "string") {
    throw new Error("expected TCP listen address");
  }
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterEach(async () => {
  setGitWriteSpawnerForTests(null);
  removeTrackedWorktrees();
  vi.unstubAllEnvs();
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
  rmSync(dir, { recursive: true, force: true });
});

describe("POST /api/issues/:id/worktree/remove", () => {
  it("returns 204 and clears worktreePath on success", async () => {
    writeStory("a");
    const path = await createWorktree("a");

    const { status, json } = await postRemove("a");
    expect(status).toBe(204);
    expect(json).toBeNull();
    expect(existsSync(path)).toBe(false);
    expect(readStoryJson("a").worktreePath).toBeUndefined();
  });

  it("returns 409 with uncommitted and at-risk counts on refusal", async () => {
    writeStory("a");
    const path = await createWorktree("a");
    writeFileSync(join(path, "README"), "dirty\n");

    const { status, json } = await postRemove("a");
    expect(status).toBe(409);
    expect(json).toEqual({
      error: expect.stringMatching(/1 uncommitted change\(s\), 0 at-risk commit\(s\)/),
      code: "conflict",
      uncommittedCount: 1,
      atRiskCommitCount: 0,
    });
    expect(existsSync(path)).toBe(true);
    expect(readStoryJson("a").worktreePath).toBe(path);
  });

  it("omits --force when discard is absent", async () => {
    recordGitRemoveCalls();
    writeStory("a");
    await createWorktree("a");

    const { status } = await postRemove("a");
    expect(status).toBe(204);
    expect(gitRemoveCalls).toHaveLength(1);
    expect(gitRemoveCalls[0]).not.toContain("--force");
  });

  it("passes discard: true through as --force", async () => {
    recordGitRemoveCalls();
    writeStory("a");
    const path = await createWorktree("a");
    writeFileSync(join(path, "README"), "dirty\n");

    const { status } = await postRemove("a", { discard: true });
    expect(status).toBe(204);
    expect(gitRemoveCalls).toHaveLength(1);
    expect(gitRemoveCalls[0]).toContain("--force");
  });

  it("returns 400 when the id is not a Story", async () => {
    writeIssue("t", {
      kind: "task",
      title: "Task",
      partOf: "e",
      status: "todo",
      order: 0,
      createdAt: AT,
      updatedAt: AT,
    });

    const { status, json } = await postRemove("e");
    expect(status).toBe(400);
    expect(json).toEqual({
      error: 'issue "e" is not a Story',
      code: "validation",
    });

    const task = await postRemove("t");
    expect(task.status).toBe(400);
    expect(task.json).toEqual({
      error: 'issue "t" is not a Story',
      code: "validation",
    });
  });
});

describe("POST /api/issues/:id/worktree/setup", () => {
  it("returns 204 on success", async () => {
    writeStory("a");
    const path = await createWorktree("a");

    const { status, json } = await postSetup("a");
    expect(status).toBe(204);
    expect(json).toBeNull();
    expect(existsSync(join(path, "SETUP_OK"))).toBe(true);
    expect(readStoryJson("a").worktreeSetupFailed).toBeUndefined();
  });

  it("returns 409 with setupLogPath when setup exits non-zero", async () => {
    writeIssue("p", {
      kind: "project",
      title: "Proj",
      workspace,
      setupCommand: "echo FAIL >&2; exit 1",
      order: 0,
      createdAt: AT,
      updatedAt: AT,
    });
    writeStory("a");
    const path = await createWorktree("a");
    const logPath = setupLogPathFor("p", "a");

    const { status, json } = await postSetup("a");
    expect(status).toBe(409);
    expect(json).toEqual({
      error: expect.stringMatching(/setup command failed/),
      code: "conflict",
      setupLogPath: logPath,
    });
    expect(existsSync(logPath)).toBe(true);
    expect(readStoryJson("a").worktreeSetupFailed).toBe(true);
    expect(existsSync(path)).toBe(true);
  });

  it("returns 400 when the id is not a Story", async () => {
    const { status, json } = await postSetup("e");
    expect(status).toBe(400);
    expect(json).toEqual({
      error: 'issue "e" is not a Story',
      code: "validation",
    });
  });
});
