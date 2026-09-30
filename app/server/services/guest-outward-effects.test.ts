import {
  ChildProcess,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import type { Server } from "node:http";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentSessions } from "./agent-sessions.js";
import {
  GUEST_REFUSED_BACKUP_CONFIG,
  GUEST_REFUSED_MERGE,
  GUEST_REFUSED_RESTART,
  GUEST_REFUSED_SECRET_DELETE,
  GUEST_REFUSED_SECRET_WRITE,
  GUEST_REFUSED_UPDATE_FROM_MERGE_BASE,
  GUEST_REFUSED_WORKTREE_ATTACH,
  GUEST_REFUSED_WORKTREE_CREATE,
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

  it("refuses worktree create and attach before any store or git write", async () => {
    const { attachStoryWorktree, createStoryWorktree } = await import(
      "./worktree.js"
    );
    const before = readIssue(issuesDir, "fresh");

    await expect(createStoryWorktree("fresh")).rejects.toMatchObject({
      code: "guest",
      message: GUEST_REFUSED_WORKTREE_CREATE,
    });
    await expect(attachStoryWorktree("story")).rejects.toMatchObject({
      code: "guest",
      message: GUEST_REFUSED_WORKTREE_ATTACH,
    });

    expect(readIssue(issuesDir, "fresh")).toEqual(before);
    expect(gitWrites).toEqual([]);
  });

  it("keeps the worktree when archiving or deleting a Story in the copy", async () => {
    const patched = await send("PATCH", "/api/issues/story", { archived: true });
    expect(patched.status).toBe(200);
    expect(readIssue(issuesDir, "story")).toMatchObject({
      archived: true,
      worktreePath: worktree,
    });

    const removed = await send("DELETE", "/api/issues/story");
    expect(removed.status).toBe(200);
    expect((await removed.json()).retainedWorktrees).toEqual([
      { id: "story", path: worktree },
    ]);

    expect(existsSync(worktree)).toBe(true);
    expect(gitWrites).toEqual([]);
  });

  it("refuses update from merge base before appending a Task", async () => {
    await expectGuest(
      await send("POST", "/api/issues/story/update-from-merge-base"),
      GUEST_REFUSED_UPDATE_FROM_MERGE_BASE,
    );
    expect(readdirSync(issuesDir).sort()).toEqual([
      "fresh",
      "platform",
      "ship",
      "story",
    ]);
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
    expect(await prs.json()).toEqual({
      prs: { story: { reason: "not-found" } },
    });
    expect(ghCalls.map((args) => args.slice(0, 2))).toEqual([
      ["api", "graphql"],
    ]);
  });

  it("refuses backup config writes and allows the backup read", async () => {
    await expectGuest(
      await send("PUT", "/api/backup", {
        remote: "git@github.com:acme/store.git",
        enabled: true,
      }),
      GUEST_REFUSED_BACKUP_CONFIG,
    );
    expect(existsSync(join(root, "app-config.json"))).toBe(false);

    const read = await send("GET", "/api/backup");
    expect(read.status).toBe(200);
    expect((await read.json()).config).toEqual({ remote: null, enabled: false });
  });

  it("refuses Project secret writes and deletes and allows the key list", async () => {
    await expectGuest(
      await send("PUT", "/api/projects/platform/secrets/API_TOKEN", {
        value: "hunter2",
      }),
      GUEST_REFUSED_SECRET_WRITE,
    );
    await expectGuest(
      await send("DELETE", "/api/projects/platform/secrets/API_TOKEN"),
      GUEST_REFUSED_SECRET_DELETE,
    );
    expect(existsSync(join(home, ".config"))).toBe(false);

    const keys = await send("GET", "/api/projects/platform/secrets");
    expect(keys.status).toBe(200);
    expect(await keys.json()).toEqual({ keys: [] });
  });

  it("refuses a supervised restart, forced or not, without initiating it", async () => {
    await expectGuest(await send("POST", "/api/restart"), GUEST_REFUSED_RESTART);
    await expectGuest(
      await send("POST", "/api/restart", { force: true }),
      GUEST_REFUSED_RESTART,
    );
    expect(initiateRestart).not.toHaveBeenCalled();
  });
});
