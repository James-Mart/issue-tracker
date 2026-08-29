import { EventEmitter } from "node:events";
import type { GitSpawner } from "../services/git-read.js";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import type { Server } from "http";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const AT = "2026-07-09T14:00:00.000Z";
const SHA = "0123456789abcdef0123456789abcdef01234567";
const OTHER_SHA = "fedcba9876543210fedcba9876543210fedcba98";
const WORKSPACE = "/repo/root";
const FILE_PATH = "src/foo.ts";
const FILE_CONTENTS = "export const foo = 1;\n";

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
  dir = mkdtempSync(join(tmpdir(), "issue-tracker-change-file-route-"));
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

describe("issue change file HTTP API", () => {
  it("returns file contents when the path exists at the requested commit", async () => {
    writeTask("t-file", { commitSha: SHA });
    await stubGitSpawner((args) => {
      if (args[0] === "show" && args[1] === `${SHA}:${FILE_PATH}`) {
        return mockGitChild({ stdout: FILE_CONTENTS });
      }
      return mockGitChild({ code: 1, stderr: `unexpected: ${args.join(" ")}` });
    });

    const url = new URL(`${baseUrl}/api/issues/t-file/change/file`);
    url.searchParams.set("path", FILE_PATH);
    url.searchParams.set("sha", SHA);
    const res = await fetch(url);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ contents: FILE_CONTENTS });
  });

  it("returns not_found when the path does not exist at the commit", async () => {
    writeTask("t-missing", { commitSha: SHA });
    await stubGitSpawner((args) => {
      if (args[0] === "show" && args[1] === `${SHA}:${FILE_PATH}`) {
        return mockGitChild({
          code: 128,
          stderr: `fatal: path '${FILE_PATH}' does not exist in '${SHA}'`,
        });
      }
      return mockGitChild({ code: 1, stderr: `unexpected: ${args.join(" ")}` });
    });

    const url = new URL(`${baseUrl}/api/issues/t-missing/change/file`);
    url.searchParams.set("path", FILE_PATH);
    url.searchParams.set("sha", SHA);
    const res = await fetch(url);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe("not_found");
    expect(body.error).toContain("does not exist in");
  });

  it("refuses a sha outside the issue commit set", async () => {
    writeTask("t-refused", { commitSha: SHA });

    const url = new URL(`${baseUrl}/api/issues/t-refused/change/file`);
    url.searchParams.set("path", FILE_PATH);
    url.searchParams.set("sha", OTHER_SHA);
    const res = await fetch(url);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("validation");
    expect(body.error).toContain(OTHER_SHA);
  });

  it("refuses Epic change file requests", async () => {
    writeTask("t-epic-child", { commitSha: SHA });

    const url = new URL(`${baseUrl}/api/issues/e/change/file`);
    url.searchParams.set("path", FILE_PATH);
    url.searchParams.set("sha", SHA);
    const res = await fetch(url);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("validation");
    expect(body.error).toContain("Epic diffs are not supported");
  });
});
