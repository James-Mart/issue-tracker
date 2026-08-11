import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import type { Server } from "http";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GhSpawner } from "../services/delivery.js";

const AT = "2026-07-09T14:00:00.000Z";
let dir: string;
let workspace: string;
let server: Server;
let baseUrl: string;
let ghCalls: { args: string[]; cwd: string }[] = [];
let setGhSpawnerForTests: (next: GhSpawner | null) => void;

function writeIssue(id: string, body: Record<string, unknown>): void {
  mkdirSync(join(dir, id), { recursive: true });
  writeFileSync(join(dir, id, "issue.json"), JSON.stringify({ id, ...body }));
}

function readStoryJson(id: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(dir, id, "issue.json"), "utf8"));
}

function mockGhChild(opts: {
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

function stubGh(
  handler?: (args: string[], cwd: string) => ReturnType<typeof mockGhChild>,
): void {
  ghCalls = [];
  const spawner: GhSpawner = (_command, args, options) => {
    ghCalls.push({ args, cwd: options.cwd });
    return (handler ?? (() => mockGhChild({})))(args, options.cwd);
  };
  setGhSpawnerForTests(spawner);
}

async function postMerge(
  id: string,
  body: unknown = {},
): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`${baseUrl}/api/issues/${id}/merge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json =
    res.status === 204 ? null : await res.json().catch(() => null);
  return { status: res.status, json };
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "issue-tracker-merge-route-"));
  workspace = mkdtempSync(join(tmpdir(), "issue-tracker-merge-route-ws-"));
  ghCalls = [];
  vi.resetModules();
  vi.stubEnv("ISSUES_DIR", dir);

  writeIssue("p", {
    kind: "project",
    title: "P",
    order: 0,
    workspace,
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
  writeIssue("a", {
    kind: "story",
    title: "A",
    partOf: "e",
    order: 0,
    branchName: "feat/a",
    merged: false,
    prUrl: "https://github.com/acme/widgets/pull/42",
    createdAt: AT,
    updatedAt: AT,
  });
  writeIssue("c1", {
    kind: "task",
    title: "Task",
    partOf: "a",
    order: 0,
    status: "todo",
    createdAt: AT,
    updatedAt: AT,
  });

  ({ setGhSpawnerForTests } = await import("../services/delivery.js"));
  setGhSpawnerForTests(null);

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
  setGhSpawnerForTests(null);
  vi.unstubAllEnvs();
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
  rmSync(dir, { recursive: true, force: true });
  rmSync(workspace, { recursive: true, force: true });
});

describe("POST /api/issues/:id/merge", () => {
  it("merges a Story via the merge service with parsed arguments", async () => {
    stubGh();

    const { status, json } = await postMerge("a", {});
    expect(status).toBe(204);
    expect(json).toBeNull();
    expect(ghCalls).toEqual([
      {
        args: ["pr", "merge", "42", "--merge", "-R", "acme/widgets"],
        cwd: workspace,
      },
    ]);
    expect(readStoryJson("a").merged).toBe(true);
  });

  it("forwards auto and matchHeadCommit to the merge service", async () => {
    stubGh();

    const { status } = await postMerge("a", {
      auto: true,
      matchHeadCommit: "deadbeef",
    });
    expect(status).toBe(204);
    expect(ghCalls[0]?.args).toEqual([
      "pr",
      "merge",
      "42",
      "--merge",
      "-R",
      "acme/widgets",
      "--auto",
      "--match-head-commit",
      "deadbeef",
    ]);
  });

  it("rejects a non-Story id the way the CLI verb does", async () => {
    stubGh();

    const epic = await postMerge("e", {});
    expect(epic.status).toBe(500);
    expect(epic.json).toMatchObject({
      error: expect.stringMatching(/merge is only valid on a Story/),
    });
    expect(ghCalls).toEqual([]);

    const task = await postMerge("c1", {});
    expect(task.status).toBe(500);
    expect(task.json).toMatchObject({
      error: expect.stringMatching(/merge is only valid on a Story/),
    });
    expect(ghCalls).toEqual([]);
  });

  it("surfaces a gh failure as an error body", async () => {
    stubGh(() =>
      mockGhChild({
        code: 1,
        stderr: "merge not allowed: repository rule violations\n",
      }),
    );

    const { status, json } = await postMerge("a", {});
    expect(status).toBe(502);
    expect(json).toMatchObject({
      error: expect.stringContaining("merge not allowed"),
      code: "gh-failed",
    });
    expect(readStoryJson("a").merged).toBe(false);
  });
});
