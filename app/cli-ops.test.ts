import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GhSpawner } from "./server/services/delivery.js";

let dir: string;
let workspace: string;
let clock = 0;
let ghCalls: { args: string[]; cwd: string }[] = [];

type CliOpsModule = typeof import("./cli-ops.js");
type DeliveryModule = typeof import("./server/services/delivery.js");

let mergeStory: CliOpsModule["mergeStory"];
let setGhSpawnerForTests: DeliveryModule["setGhSpawnerForTests"];

function nextAt(): string {
  clock += 1;
  return new Date(Date.UTC(2026, 6, 10, 14, 0, clock)).toISOString();
}

function readStoryJson(id: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(dir, id, "issue.json"), "utf8")) as Record<
    string,
    unknown
  >;
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
    return (
      handler ??
      ((next: string[]) =>
        mockGhChild(
          next[0] === "api" && next[1] === "graphql"
            ? { stdout: JSON.stringify({ data: { repository: null } }) }
            : {},
        ))
    )(args, options.cwd);
  };
  setGhSpawnerForTests(spawner);
}

async function loadModules(): Promise<void> {
  vi.resetModules();
  process.env.ISSUES_DIR = dir;
  const cliOps = await import("./cli-ops.js");
  const delivery = await import("./server/services/delivery.js");
  mergeStory = cliOps.mergeStory;
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
  writeIssue("sibling", {
    kind: "story",
    title: "Sibling",
    partOf: "e",
    order: 1,
    branchName: "feat/sibling",
    merged: false,
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
    expect(ghCalls[0]).toEqual({
      args: ["pr", "merge", "42", "--merge", "-R", "acme/widgets"],
      cwd: workspace,
    });
    expect(ghCalls).toHaveLength(2);
    expect(ghCalls[1]?.args.slice(0, 2)).toEqual(["api", "graphql"]);
  });

  it("leaves every field untouched when gh fails", async () => {
    writeIssue("before", {
      kind: "story",
      title: "Before snapshot",
      partOf: "e",
      order: 4,
      branchName: "feat/before",
      merged: false,
      needsRebase: "feat/old",
      createdAt: nextAt(),
      updatedAt: nextAt(),
    });
    await loadModules();
    stubGh(() =>
      mockGhChild({
        code: 1,
        stderr: "merge not allowed\n",
      }),
    );
    await expect(mergeStory("a")).rejects.toThrow("merge not allowed");
    expect(readStoryJson("a").merged).toBe(false);
    expect(readStoryJson("sibling").needsRebase).toBeUndefined();
    expect(readStoryJson("before").merged).toBe(false);
    expect(readStoryJson("before").needsRebase).toBe("feat/old");
  });
});
