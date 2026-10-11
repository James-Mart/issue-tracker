import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const reconcileProjectPrs = vi.hoisted(() => vi.fn());

vi.mock("./pr-reconcile.js", () => ({
  reconcileProjectPrs,
}));

vi.mock("./issue-events.js", async () => {
  const actual = await vi.importActual<typeof import("./issue-events.js")>(
    "./issue-events.js",
  );
  return { ...actual, startIssueEventsWatcher: vi.fn() };
});

const AT = "2026-07-09T14:00:00.000Z";

let dir: string;

function okResult() {
  return { checked: 0, writes: [], matches: new Map(), facts: new Map() };
}

function writeIssue(id: string, body: Record<string, unknown>): void {
  mkdirSync(join(dir, id), { recursive: true });
  writeFileSync(join(dir, id, "issue.json"), JSON.stringify({ id, ...body }));
}

function project(id: string): void {
  writeIssue(id, {
    kind: "project",
    title: id,
    order: 0,
    workspace: "/repo",
    createdAt: AT,
    updatedAt: AT,
  });
}

async function load() {
  const config = await import("../config.js");
  config.refreshStorePathsFromEnv();
  return import("./pr-sync-driver.js");
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pr-sync-driver-"));
  vi.resetModules();
  vi.stubEnv("ISSUES_DIR", dir);
  vi.stubEnv("ISSUE_TRACKER_GUEST", "");
  vi.stubEnv("AGENT_STACK_PORT", "");
  reconcileProjectPrs.mockReset();
  reconcileProjectPrs.mockResolvedValue(okResult());
});

afterEach(async () => {
  const driver = await import("./pr-sync-driver.js");
  await driver.resetPrSyncDriverForTests();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

describe("runSyncPass", () => {
  it("queues a second pass for one Project until the first finishes", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    reconcileProjectPrs.mockImplementation(async () => {
      calls += 1;
      if (calls === 1) await gate;
      return okResult();
    });
    const { runSyncPass } = await load();

    const first = runSyncPass("p");
    await settle();
    const second = runSyncPass("p");
    await settle();
    expect(calls).toBe(1);

    release();
    await Promise.all([first, second]);
    expect(calls).toBe(2);
  });
});

describe("startPrSyncDriver", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "setInterval", "Date"] });
    vi.setSystemTime(new Date("2026-08-01T00:00:00.000Z"));
  });

  it("skips passes on a guest server", async () => {
    vi.stubEnv("ISSUE_TRACKER_GUEST", "1");
    project("p");
    const driver = await load();
    driver.startPrSyncDriver();
    await settle();
    await vi.advanceTimersByTimeAsync(driver.PR_SYNC_CADENCE_MS);
    await settle();
    expect(reconcileProjectPrs).not.toHaveBeenCalled();
  });

  it("skips passes inside an agent verification stack", async () => {
    vi.stubEnv("AGENT_STACK_PORT", "41002");
    project("p");
    const driver = await load();
    driver.startPrSyncDriver();
    await settle();
    await vi.advanceTimersByTimeAsync(driver.PR_SYNC_CADENCE_MS);
    await settle();
    expect(reconcileProjectPrs).not.toHaveBeenCalled();
  });
});
