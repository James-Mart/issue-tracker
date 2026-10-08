import {
  ChildProcess,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GitSpawner } from "./git-read.js";

const AT = "2026-07-09T14:00:00.000Z";

let dir: string;

function writeIssue(id: string, body: Record<string, unknown>): void {
  mkdirSync(join(dir, id), { recursive: true });
  writeFileSync(join(dir, id, "issue.json"), JSON.stringify({ id, ...body }));
}

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

function mockGitChild(opts: { code?: number; stdout?: string; stderr?: string }) {
  const child = fakeChildProcess();
  setImmediate(() => {
    if (opts.stdout) child.stdout.emit("data", opts.stdout);
    if (opts.stderr) child.stderr.emit("data", opts.stderr);
    child.emit("close", opts.code ?? 0);
  });
  return child;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "issue-tracker-project-worktrees-"));
  vi.resetModules();
  vi.stubEnv("ISSUES_DIR", dir);
  writeIssue("p", {
    kind: "project",
    title: "P",
    order: 0,
    createdAt: AT,
    updatedAt: AT,
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

describe("projectWorktrees in-flight sharing", () => {
  it("shares one computation across concurrent callers and reads again after it settles", async () => {
    const path = mkdtempSync(join(dir, "wt-"));
    writeFileSync(join(path, ".git"), "gitdir: /nowhere\n");
    writeIssue("s", {
      kind: "story",
      title: "S",
      partOf: "p",
      branchName: "feat",
      worktreePath: path,
      order: 0,
      createdAt: AT,
      updatedAt: AT,
    });

    let spawns = 0;
    const spawner: GitSpawner = (_command, args) => {
      spawns += 1;
      if (args[0] === "rev-parse") {
        return mockGitChild({
          code: 1,
          stderr: "fatal: no upstream configured for branch 'feat'\n",
        });
      }
      if (args[0] === "rev-list") return mockGitChild({ stdout: "0\t0\n" });
      return mockGitChild({ stdout: "" });
    };

    const { setGitSpawnerForTests } = await import("./git-read.js");
    setGitSpawnerForTests(spawner);
    const { projectWorktrees } = await import("./project-worktrees.js");
    const first = projectWorktrees("p");
    const second = projectWorktrees("p");
    expect(second).toBe(first);
    await first;
    const during = spawns;
    expect(during).toBeGreaterThan(0);

    await projectWorktrees("p");
    expect(spawns).toBe(during * 2);
  });
});
