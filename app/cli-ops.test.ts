import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GhSpawner } from "./server/services/delivery.js";

let dir: string;
let workspace: string;
let clock = 0;
let ghCalls: { args: string[]; cwd: string }[] = [];

type CliOpsModule = typeof import("./cli-ops.js");
type DeliveryModule = typeof import("./server/services/delivery.js");

let mergeStory: CliOpsModule["mergeStory"];
let registerBareIdOps: CliOpsModule["registerBareIdOps"];
let registerKindOps: CliOpsModule["registerKindOps"];
let setGhSpawnerForTests: DeliveryModule["setGhSpawnerForTests"];

function nextAt(): string {
  clock += 1;
  return new Date(Date.UTC(2026, 6, 10, 14, 0, clock)).toISOString();
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

async function runMergeCli(
  args: string[],
): Promise<{ stdout: string; stderr: string; exitCode: number | undefined }> {
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  const consoleError = vi
    .spyOn(console, "error")
    .mockImplementation((message?: unknown) => {
      stderrChunks.push(String(message ?? ""));
    });

  const program = new Command();
  program.exitOverride();
  const run = async (action: () => unknown) => {
    try {
      await action();
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    }
  };
  registerBareIdOps(program, run);
  const storyCmd = program.command("story");
  registerKindOps(storyCmd, "story", run);

  let exitCode: number | undefined;
  try {
    await program.parseAsync(["node", "test", ...args]);
  } catch (err) {
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code: string }).code === "commander.helpDisplayed"
    ) {
      exitCode = 0;
    } else {
      throw err;
    }
  } finally {
    exitCode = process.exitCode;
    process.exitCode = undefined;
    consoleError.mockRestore();
  }

  return {
    stdout: stdoutChunks.join(""),
    stderr: stderrChunks.join(""),
    exitCode,
  };
}

async function loadModules(): Promise<void> {
  vi.resetModules();
  process.env.ISSUES_DIR = dir;
  const cliOps = await import("./cli-ops.js");
  const delivery = await import("./server/services/delivery.js");
  mergeStory = cliOps.mergeStory;
  registerBareIdOps = cliOps.registerBareIdOps;
  registerKindOps = cliOps.registerKindOps;
  setGhSpawnerForTests = delivery.setGhSpawnerForTests;
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "issue-cli-ops-"));
  workspace = mkdtempSync(join(tmpdir(), "issue-cli-ops-ws-"));
  clock = 0;
  ghCalls = [];
  writeIssue("p", {
    kind: "project",
    title: "Proj",
    workspace,
    createdAt: nextAt(),
    updatedAt: nextAt(),
  });
  writeIssue("e", {
    kind: "epic",
    title: "Epic",
    partOf: "p",
    order: 0,
    blockedBy: [],
    createdAt: nextAt(),
    updatedAt: nextAt(),
  });
  writeIssue("a", {
    kind: "story",
    title: "Story A",
    partOf: "e",
    order: 0,
    branchName: "feat/a",
    merged: false,
    prUrl: "https://github.com/acme/widgets/pull/42",
    createdAt: nextAt(),
    updatedAt: nextAt(),
  });
  writeIssue("c1", {
    kind: "task",
    title: "Task",
    partOf: "a",
    order: 0,
    status: "todo",
    createdAt: nextAt(),
    updatedAt: nextAt(),
  });
  await loadModules();
});

afterEach(() => {
  if (setGhSpawnerForTests) setGhSpawnerForTests(null);
  delete process.env.ISSUES_DIR;
  rmSync(dir, { recursive: true, force: true });
  rmSync(workspace, { recursive: true, force: true });
});

describe("mergeStory", () => {
  it("invokes gh pr merge --merge with repo from prUrl and project workspace cwd", async () => {
    stubGh();
    await mergeStory("a");
    expect(ghCalls).toEqual([
      {
        args: ["pr", "merge", "42", "--merge", "-R", "acme/widgets"],
        cwd: workspace,
      },
    ]);
  });

  it("forwards --auto and --match-head-commit", async () => {
    stubGh();
    await mergeStory("a", {
      auto: true,
      matchHeadCommit: "abc123def4567890123456789012345678901234",
    });
    expect(ghCalls[0]?.args).toEqual([
      "pr",
      "merge",
      "42",
      "--merge",
      "-R",
      "acme/widgets",
      "--auto",
      "--match-head-commit",
      "abc123def4567890123456789012345678901234",
    ]);
  });

  it("refuses when the Story has no prUrl", async () => {
    writeIssue("b", {
      kind: "story",
      title: "No PR",
      partOf: "e",
      order: 1,
      branchName: "feat/b",
      merged: false,
      createdAt: nextAt(),
      updatedAt: nextAt(),
    });
    await loadModules();
    stubGh();
    await expect(mergeStory("b")).rejects.toThrow('story "b" has no prUrl');
    expect(ghCalls).toHaveLength(0);
  });

  it("surfaces gh stderr on failure", async () => {
    stubGh(() =>
      mockGhChild({
        code: 1,
        stderr: "GraphQL: Pull request is in draft state\n",
      }),
    );
    await expect(mergeStory("a")).rejects.toThrow(
      "GraphQL: Pull request is in draft state",
    );
  });
});

describe("issue merge CLI", () => {
  it("runs bare issue merge with the same gh argv as mergeStory", async () => {
    stubGh();
    const result = await runMergeCli(["merge", "a"]);
    expect(result.exitCode).toBeUndefined();
    expect(ghCalls).toEqual([
      {
        args: ["pr", "merge", "42", "--merge", "-R", "acme/widgets"],
        cwd: workspace,
      },
    ]);
  });

  it("forwards flags on bare issue merge", async () => {
    stubGh();
    await runMergeCli([
      "merge",
      "a",
      "--auto",
      "--match-head-commit",
      "abc123def4567890123456789012345678901234",
    ]);
    expect(ghCalls[0]?.args).toContain("--auto");
    expect(ghCalls[0]?.args).toContain("--match-head-commit");
  });

  it("matches issue story merge to the bare form", async () => {
    stubGh();
    const bare = await runMergeCli(["merge", "a"]);
    const scoped = await runMergeCli(["story", "merge", "a"]);
    expect(bare.exitCode).toBeUndefined();
    expect(scoped.exitCode).toBeUndefined();
    expect(ghCalls).toHaveLength(2);
    expect(ghCalls[0]).toEqual(ghCalls[1]);
  });

  it("refuses merge on an Epic with a message naming the valid form", async () => {
    stubGh();
    const result = await runMergeCli(["merge", "e"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('"e" is an Epic');
    expect(result.stderr).toContain("merge is only valid on a Story");
    expect(result.stderr).toContain("issue merge <storyId>");
    expect(ghCalls).toHaveLength(0);
  });

  it("refuses merge on a Task with a message naming the valid form", async () => {
    stubGh();
    const result = await runMergeCli(["merge", "c1"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('"c1" is a Task');
    expect(result.stderr).toContain("merge is only valid on a Story");
    expect(ghCalls).toHaveLength(0);
  });

  it("exits non-zero when gh refuses the merge", async () => {
    stubGh(() =>
      mockGhChild({
        code: 1,
        stderr: "merge not allowed: repository rule violations\n",
      }),
    );
    const result = await runMergeCli(["merge", "a"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("merge not allowed");
  });
});
