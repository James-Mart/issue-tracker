import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import type { Server } from "http";
import { tmpdir } from "os";
import { dirname, join } from "path";
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

function seedProject(): void {
  writeIssue("p", {
    kind: "project",
    title: "Proj",
    workspace,
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

function conversationsRoot(): string {
  return join(dirname(dir), "conversations");
}

function seedImplementingSession(
  convId: string,
  storyId: string,
  projectId: string,
  opts?: { live?: boolean },
): void {
  const convDir = join(conversationsRoot(), convId);
  mkdirSync(convDir, { recursive: true });
  writeFileSync(
    join(convDir, "meta.json"),
    JSON.stringify({
      id: convId,
      title: "Implement",
      projectId,
      model: "auto",
      issueId: storyId,
      channel: "implementing",
      createdAt: AT,
      updatedAt: AT,
    }),
  );
  if (opts?.live) {
    writeFileSync(
      join(convDir, "run-live.json"),
      `${JSON.stringify({ pid: process.pid })}\n`,
    );
  }
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

function isPidCollected(pid: number): boolean {
  return !existsSync(`/proc/${pid}`);
}

async function waitUntilCollected(pid: number): Promise<boolean> {
  for (let i = 0; i < 100 && !isPidCollected(pid); i++) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return isPidCollected(pid);
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

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "issue-wt-routes-"));
  workspace = initRepo();
  vi.resetModules();
  vi.stubEnv("ISSUES_DIR", dir);

  seedProject();

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
  removeTrackedWorktrees();
  rmSync(conversationsRoot(), { recursive: true, force: true });
  vi.unstubAllEnvs();
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
  rmSync(dir, { recursive: true, force: true });
});

describe("POST /api/issues/:id/worktree/remove", () => {
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

  it("ignores allowActiveRun in the body and refuses while a session is live", async () => {
    writeStory("a");
    const path = await createWorktree("a");
    seedImplementingSession("conv-live", "a", "p", { live: true });

    const { status, json } = await postRemove("a", { allowActiveRun: true });
    expect(status).toBe(409);
    expect(json).toEqual({
      error: expect.stringMatching(/implementing session is active/),
      code: "conflict",
    });
    expect(existsSync(path)).toBe(true);
    expect(readStoryJson("a").worktreePath).toBe(path);
  });
});

describe("POST /api/issues/:id/worktree/setup", () => {
  it("kills the setup process group at the timeout and records a failing setup", async () => {
    // beforeEach resetModules, so the server is bound to a fresh worktree module.
    const { setWorktreeSetupTimeoutMsForTests, WORKTREE_SETUP_TIMEOUT_LINE } = await import(
      "../services/worktree.js"
    );
    setWorktreeSetupTimeoutMsForTests(400);
    const pidFile = join(dir, "grandchild.pid");
    writeIssue("p", {
      kind: "project",
      title: "Proj",
      workspace,
      setupCommand: `printf partial; bash -c 'trap "" HUP; sleep 2' & echo $! > ${JSON.stringify(pidFile)}; wait`,
      order: 0,
      createdAt: AT,
      updatedAt: AT,
    });
    writeStory("a");
    const path = await createWorktree("a");
    const logPath = setupLogPathFor("p", "a");

    try {
      const { status, json } = await postSetup("a");
      expect(status).toBe(409);
      expect(json).toEqual({
        error: expect.stringMatching(/setup command failed/),
        code: "conflict",
        setupLogPath: logPath,
      });
      expect(readFileSync(logPath, "utf8")).toBe(`partial\n${WORKTREE_SETUP_TIMEOUT_LINE}\n`);
      expect(readStoryJson("a").worktreeSetupFailed).toBe(true);
      expect(existsSync(path)).toBe(true);
      const grandchild = Number(readFileSync(pidFile, "utf8").trim());
      expect(await waitUntilCollected(grandchild)).toBe(true);
    } finally {
      setWorktreeSetupTimeoutMsForTests(undefined);
    }
  });
});
