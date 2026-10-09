import { ChildProcess, type ChildProcessWithoutNullStreams } from "node:child_process";
import { PassThrough } from "node:stream";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import type { Server } from "http";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GhSpawner } from "../services/delivery.js";

const AT = "2026-07-09T14:00:00.000Z";

let dir: string;
let workspaceDir: string;
let server: Server;
let baseUrl: string;
let setGhSpawnerForTests: (next: GhSpawner | null) => void;
let replacePrFactsCache: typeof import("../services/pr-facts-cache.js").replacePrFactsCache;
let clearPrFactsCache: () => void;
let setPrSyncStatusForTests: (
  projectId: string,
  status: {
    lastSyncedAt?: string;
    lastError?: { message: string; at: string };
  },
) => void;

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

function writeIssue(id: string, body: Record<string, unknown>): void {
  mkdirSync(join(dir, id), { recursive: true });
  writeFileSync(join(dir, id, "issue.json"), JSON.stringify({ id, ...body }));
}

function mockGhChild(opts: {
  code?: number | null;
  stdout?: string;
  stderr?: string;
}) {
  const child = fakeChildProcess();

  setImmediate(() => {
    if (opts.stdout) child.stdout.emit("data", opts.stdout);
    if (opts.stderr) child.stderr.emit("data", opts.stderr);
    child.emit("close", opts.code ?? 0);
  });

  return child;
}

function stubGhSpawner(
  handler: (args: string[], workspace: string) => ReturnType<typeof mockGhChild>,
): void {
  const spawner: GhSpawner = (_command, args, options) =>
    handler(args, options.cwd);
  setGhSpawnerForTests(spawner);
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "issue-tracker-prs-route-"));
  workspaceDir = mkdtempSync(join(tmpdir(), "issue-workspace-prs-route-"));
  mkdirSync(join(workspaceDir, ".git"));
  vi.resetModules();
  vi.stubEnv("ISSUES_DIR", dir);

  ({ setGhSpawnerForTests } = await import("../services/delivery.js"));
  setGhSpawnerForTests(null);
  ({ replacePrFactsCache, clearPrFactsCache } = await import(
    "../services/pr-facts-cache.js"
  ));
  ({ setPrSyncStatusForTests } = await import("../services/pr-sync-driver.js"));

  writeIssue("p", {
    kind: "project",
    title: "P",
    order: 0,
    workspace: workspaceDir,
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
  writeIssue("s1", {
    kind: "story",
    title: "Story one",
    partOf: "e",
    order: 0,
    merged: false,
    prUrl: "https://github.com/acme/widgets/pull/1",
    createdAt: AT,
    updatedAt: AT,
  });
  writeIssue("s2", {
    kind: "story",
    title: "Story two",
    partOf: "e",
    order: 1,
    merged: false,
    prUrl: "https://github.com/acme/widgets/pull/2",
    createdAt: AT,
    updatedAt: AT,
  });
  writeIssue("s-no-pr", {
    kind: "story",
    title: "No PR",
    partOf: "e",
    order: 2,
    merged: false,
    createdAt: AT,
    updatedAt: AT,
  });

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
  if (setGhSpawnerForTests) setGhSpawnerForTests(null);
  clearPrFactsCache?.();
  const driver = await import("../services/pr-sync-driver.js");
  await driver.resetPrSyncDriverForTests();
  vi.unstubAllEnvs();
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
  rmSync(dir, { recursive: true, force: true });
  rmSync(workspaceDir, { recursive: true, force: true });
});

async function getProjectPrs(projectId: string, query = ""): Promise<Response> {
  return fetch(`${baseUrl}/api/projects/${projectId}/prs${query}`);
}

describe("project PRs HTTP API", () => {
  it("returns last-pass cached facts and sync status without calling gh", async () => {
    let ghCalled = false;
    stubGhSpawner(() => {
      ghCalled = true;
      return mockGhChild({ stdout: "{}" });
    });
    replacePrFactsCache("p", {
      s1: {
        number: 1,
        url: "https://github.com/acme/widgets/pull/1",
        state: "open",
        isDraft: false,
        mergeable: "mergeable",
        mergeStateStatus: "CLEAN",
        reviewDecision: null,
        checks: { state: "success", failing: 0, pending: 0, total: 0 },
        commentCount: 0,
        comments: [],
        headRefOid: "abc123",
        baseRefName: "main",
        updatedAt: "2026-08-01T00:00:00Z",
      },
    });
    setPrSyncStatusForTests("p", {
      lastSyncedAt: "2026-08-01T00:00:00.000Z",
    });

    const res = await getProjectPrs("p");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(ghCalled).toBe(false);
    expect(body.sync).toEqual({ lastSyncedAt: "2026-08-01T00:00:00.000Z" });
    expect(body.prs.s1).toMatchObject({
      number: 1,
      url: "https://github.com/acme/widgets/pull/1",
      state: "open",
    });
    expect(body.prs).not.toHaveProperty("s-no-pr");
    expect(body.prs).not.toHaveProperty("s2");
  });
});
