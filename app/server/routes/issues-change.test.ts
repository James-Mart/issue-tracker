import { EventEmitter } from "node:events";
import type { GitSpawner } from "../services/git-read.js";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import type { Server } from "http";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const AT = "2026-07-09T14:00:00.000Z";
const SHA = "0123456789abcdef0123456789abcdef01234567";
const WORKSPACE = "/repo/root";

let dir: string;
let server: Server;
let baseUrl: string;

function writeIssue(id: string, body: Record<string, unknown>): void {
  mkdirSync(join(dir, id), { recursive: true });
  writeFileSync(join(dir, id, "issue.json"), JSON.stringify({ id, ...body }));
}

function mockGitChild(opts: {
  code?: number | null;
  stdout?: string;
  stderr?: string;
}) {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();

  setImmediate(() => {
    if (opts.stdout) child.stdout.emit("data", opts.stdout);
    if (opts.stderr) child.stderr.emit("data", opts.stderr);
    child.emit("close", opts.code ?? 0);
  });

  return child;
}

function stubGitSpawner(
  handler: (args: string[], workspace: string) => ReturnType<typeof mockGitChild>,
): Promise<void> {
  return import("../services/git-read.js").then(({ setGitSpawnerForTests }) => {
    const spawner: GitSpawner = (_command, args, options) =>
      handler(args, options.cwd);
    setGitSpawnerForTests(spawner);
  });
}

function writeTask(id: string, extra: Record<string, unknown> = {}): void {
  writeIssue(id, {
    kind: "task",
    title: id,
    partOf: "b",
    status: "done",
    order: 0,
    createdAt: AT,
    updatedAt: AT,
    ...extra,
  });
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "issue-tracker-change-route-"));
  vi.resetModules();
  vi.stubEnv("ISSUES_DIR", dir);

  writeIssue("p", {
    kind: "project",
    title: "P",
    workspace: WORKSPACE,
    order: 0,
    createdAt: AT,
    updatedAt: AT,
  });
  writeIssue("e", {
    kind: "epic",
    title: "E",
    partOf: "p",
    order: 0,
    createdAt: AT,
    updatedAt: AT,
  });
  writeIssue("b", {
    kind: "story",
    title: "B",
    partOf: "e",
    merged: false,
    order: 0,
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
  const { setGitSpawnerForTests } = await import("../services/git-read.js");
  setGitSpawnerForTests(null);
  vi.unstubAllEnvs();
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
  rmSync(dir, { recursive: true, force: true });
});

describe("issue change HTTP API", () => {
  it("returns a loaded change when the Task commit resolves", async () => {
    writeTask("t-loaded", { commitSha: SHA });
    await stubGitSpawner((args) => {
      if (args[0] === "show" && args.includes("--format=%s")) {
        return mockGitChild({ stdout: "Add feature\n" });
      }
      if (args[0] === "show" && args.includes("--patch")) {
        return mockGitChild({
          stdout: "diff --git a/foo.ts b/foo.ts\n+line\n",
        });
      }
      if (args[0] === "show" && args.includes("--stat")) {
        return mockGitChild({
          stdout: " 2 files changed, 5 insertions(+), 1 deletion(-)\n",
        });
      }
      return mockGitChild({ code: 1, stderr: `unexpected: ${args.join(" ")}` });
    });

    const res = await fetch(`${baseUrl}/api/issues/t-loaded/change`);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      state: "loaded",
      commits: [{ sha: SHA, subject: "Add feature" }],
      patch: "diff --git a/foo.ts b/foo.ts\n+line\n",
      stats: { filesChanged: 2, insertions: 5, deletions: 1 },
    });
  });

  it("returns an empty change when the Task has no sha", async () => {
    writeTask("t-empty");

    const res = await fetch(`${baseUrl}/api/issues/t-empty/change`);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      state: "empty",
      reason: "no-commit",
    });
  });

  it("returns a failure status when the recorded sha is unreachable", async () => {
    writeTask("t-unreachable", { commitSha: SHA });
    await stubGitSpawner(() =>
      mockGitChild({
        code: 128,
        stderr: `fatal: bad object ${SHA}`,
      }),
    );

    const res = await fetch(`${baseUrl}/api/issues/t-unreachable/change`);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe("commit-unreachable");
    expect(body.error).toContain("bad object");
  });
});
