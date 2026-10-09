import {
  ChildProcess,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import type { Server } from "node:http";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentSessions } from "./agent-sessions.js";
import {
  GUEST_REFUSED_MERGE,
  GUEST_REFUSED_WORKTREE_REMOVE,
  GUEST_REFUSED_WORKTREE_SETUP,
} from "./guest-outward-effects.js";
import {
  createGuestStore,
  disposeGuestStore,
  expectGuest,
  type GuestStore,
  listen,
  readIssue,
  writeIssue,
} from "./guest-refusal.test-harness.js";

const PR_URL = "https://github.com/acme/app/pull/7";

let store: GuestStore;
let root: string;
let home: string;
let issuesDir: string;
let workspace: string;
let worktree: string;
let server: Server | undefined;
let baseUrl: string;
let gitWrites: string[][];
let ghCalls: string[][];
let initiateRestart: ReturnType<typeof vi.fn>;

function fakeChild(stdout: string): ChildProcessWithoutNullStreams {
  const stdin = new PassThrough();
  const out = new PassThrough();
  const stderr = new PassThrough();
  const child = Object.assign(new ChildProcess(), {
    stdin,
    stdout: out,
    stderr,
    stdio: [stdin, out, stderr, undefined, undefined],
  }) as ChildProcessWithoutNullStreams;
  setImmediate(() => {
    child.stdout.emit("data", stdout);
    child.emit("close", 0);
  });
  return child;
}

function stubSessions(): AgentSessions {
  return {
    sendPrompt: vi.fn(),
    getActiveRun: () => undefined,
    listActiveRuns: () => [],
    cancel: vi.fn(),
    dispose: vi.fn(),
    disposeAll: vi.fn(),
  };
}

function send(method: string, path: string, body?: unknown) {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(async () => {
  store = createGuestStore("issue-tracker-guest-outward-");
  ({ root, issuesDir } = store);
  home = join(root, "home");
  workspace = join(root, "workspace");
  worktree = join(root, "story-worktree");
  mkdirSync(home, { recursive: true });
  mkdirSync(workspace, { recursive: true });
  mkdirSync(worktree, { recursive: true });
  vi.stubEnv("HOME", home);
  server = undefined;

  writeIssue(issuesDir, "platform", {
    kind: "project",
    title: "Platform",
    order: 0,
    workspace,
    setupCommand: `touch ${join(root, "setup-ran")}`,
  });
  writeIssue(issuesDir, "ship", {
    kind: "epic",
    title: "Ship",
    partOf: "platform",
    order: 1,
  });
  writeIssue(issuesDir, "story", {
    kind: "story",
    title: "Story",
    partOf: "ship",
    order: 1,
    mergeBase: "main",
    branchName: "story",
    worktreePath: worktree,
    prUrl: PR_URL,
  });
  writeIssue(issuesDir, "fresh", {
    kind: "story",
    title: "Fresh",
    partOf: "ship",
    order: 2,
    mergeBase: "main",
  });

  gitWrites = [];
  ghCalls = [];
  const { setGitWriteSpawnerForTests } = await import("./git-write.js");
  setGitWriteSpawnerForTests((_command, args) => {
    gitWrites.push(args);
    return fakeChild("");
  });
  const { setGhSpawnerForTests } = await import("./delivery.js");
  setGhSpawnerForTests((_command, args) => {
    ghCalls.push(args);
    return fakeChild(JSON.stringify({ data: { repository: null } }));
  });

  initiateRestart = vi.fn();
  const { createApp } = await import("../app.js");
  const { captureRestartSupervision } = await import("../restart-contract.js");
  captureRestartSupervision(true);
  ({ server, baseUrl } = await listen(createApp(stubSessions(), initiateRestart)));
});

afterEach(async () => {
  await disposeGuestStore(store, server);
});

describe("guest outward-effect refusals", () => {
  it("refuses worktree remove and setup before git or the setup command", async () => {
    await expectGuest(
      await send("POST", "/api/issues/story/worktree/remove", { discard: true }),
      GUEST_REFUSED_WORKTREE_REMOVE,
    );
    await expectGuest(
      await send("POST", "/api/issues/story/worktree/setup"),
      GUEST_REFUSED_WORKTREE_SETUP,
    );

    expect(existsSync(worktree)).toBe(true);
    expect(existsSync(join(root, "setup-ran"))).toBe(false);
    expect(readIssue(issuesDir, "story").worktreePath).toBe(worktree);
    expect(gitWrites).toEqual([]);
  });

  it("refuses merge before gh and allows PR status reads", async () => {
    await expectGuest(
      await send("POST", "/api/issues/story/merge", {}),
      GUEST_REFUSED_MERGE,
    );
    expect(ghCalls).toEqual([]);
    expect(readIssue(issuesDir, "story").merged).toBeUndefined();

    const prs = await send("GET", "/api/projects/platform/prs");
    expect(prs.status).toBe(200);
    expect(await prs.json()).toEqual({ prs: {}, sync: {} });
    expect(ghCalls).toEqual([]);
  });
});
