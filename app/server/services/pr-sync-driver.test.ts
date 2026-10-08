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

function okResult(matches = new Map<string, string>()) {
  return { checked: matches.size, writes: [], matches, facts: new Map() };
}

function writeIssue(id: string, body: Record<string, unknown>): void {
  mkdirSync(join(dir, id), { recursive: true });
  writeFileSync(join(dir, id, "issue.json"), JSON.stringify({ id, ...body }));
}

function project(
  id: string,
  extra: Record<string, unknown> = { workspace: "/repo" },
): void {
  writeIssue(id, {
    kind: "project",
    title: id,
    order: 0,
    createdAt: AT,
    updatedAt: AT,
    ...extra,
  });
}

function story(id: string, partOf: string, extra: Record<string, unknown> = {}): void {
  writeIssue(id, {
    kind: "story",
    title: id,
    partOf,
    branchName: `feat/${id}`,
    order: 0,
    merged: false,
    createdAt: AT,
    updatedAt: AT,
    ...extra,
  });
}

function task(
  id: string,
  partOf: string,
  status: "todo" | "done",
): void {
  writeIssue(id, {
    kind: "task",
    title: id,
    partOf,
    status,
    order: 0,
    createdAt: AT,
    updatedAt: AT,
  });
}

async function load() {
  const config = await import("../config.js");
  config.refreshStorePathsFromEnv();
  const driver = await import("./pr-sync-driver.js");
  const stream = await import("./conversation-stream.js");
  const events = await import("./issue-events.js");
  return { ...driver, publishFrame: stream.publishFrame, ISSUES_TOPIC: events.ISSUES_TOPIC };
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
  it("runs reconcile first and hands matches to the next step", async () => {
    const matches = new Map([["ship", "https://github.com/acme/widgets/pull/7"]]);
    reconcileProjectPrs.mockResolvedValue(okResult(matches));
    const seen: string[] = [];
    const { registerPrSyncStep, runSyncPass, prSyncStatus } = await load();
    registerPrSyncStep(async (projectId, previous) => {
      seen.push(`${projectId}:${previous.matches?.get("ship")}`);
      return previous;
    });

    vi.setSystemTime(new Date("2026-08-01T00:00:00.000Z"));
    const result = await runSyncPass("p");

    expect(reconcileProjectPrs).toHaveBeenCalledWith("p");
    expect(seen).toEqual(["p:https://github.com/acme/widgets/pull/7"]);
    expect(result.matches).toBe(matches);
    expect(prSyncStatus("p")).toEqual({ lastSyncedAt: "2026-08-01T00:00:00.000Z" });
  });

  it("stops the pass when a step returns error and keeps the prior success time", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { registerPrSyncStep, runSyncPass, prSyncStatus } = await load();
    vi.setSystemTime(new Date("2026-08-01T00:00:00.000Z"));
    await runSyncPass("p");

    const ran: string[] = [];
    registerPrSyncStep(async () => ({ error: "mirror down" }));
    registerPrSyncStep(async () => {
      ran.push("later");
      return {};
    });
    vi.setSystemTime(new Date("2026-08-01T00:05:00.000Z"));
    reconcileProjectPrs.mockResolvedValue(okResult(new Map([["ship", "u"]])));

    const result = await runSyncPass("p");

    expect(result).toEqual({ error: "mirror down" });
    expect(ran).toEqual([]);
    expect(prSyncStatus("p")).toEqual({
      lastSyncedAt: "2026-08-01T00:00:00.000Z",
      lastError: { message: "mirror down", at: "2026-08-01T00:05:00.000Z" },
    });
    expect(error).toHaveBeenCalledWith("pr sync failed for p: mirror down");
  });

  it("does not run later steps when reconcile returns error", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    reconcileProjectPrs.mockResolvedValue({ ...okResult(), error: "gh down" });
    const { registerPrSyncStep, runSyncPass, prSyncStatus } = await load();
    const ran: string[] = [];
    registerPrSyncStep(async () => {
      ran.push("later");
      return {};
    });
    vi.setSystemTime(new Date("2026-08-01T00:00:00.000Z"));

    await runSyncPass("p");

    expect(ran).toEqual([]);
    expect(prSyncStatus("p")).toEqual({
      lastError: { message: "gh down", at: "2026-08-01T00:00:00.000Z" },
    });
    expect(error).toHaveBeenCalledWith("pr sync failed for p: gh down");
  });

  it("logs a thrown step, records lastError, and still runs the next queued pass", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { registerPrSyncStep, runSyncPass, prSyncStatus } = await load();
    registerPrSyncStep(async () => {
      throw new Error("boom");
    });
    const later: string[] = [];
    registerPrSyncStep(async () => {
      later.push("skipped");
      return {};
    });
    vi.setSystemTime(new Date("2026-08-01T00:00:00.000Z"));

    const failed = await runSyncPass("p");

    expect(failed).toEqual({ error: "boom" });
    expect(later).toEqual([]);
    expect(prSyncStatus("p").lastError).toEqual({
      message: "boom",
      at: "2026-08-01T00:00:00.000Z",
    });
    expect(error).toHaveBeenCalledWith("pr sync failed for p:", expect.any(Error));

    await runSyncPass("p");
    expect(reconcileProjectPrs).toHaveBeenCalledTimes(2);
    expect(prSyncStatus("p").lastError?.message).toBe("boom");
  });

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

  it("runs different Projects at the same time", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const entered: string[] = [];
    reconcileProjectPrs.mockImplementation(async (projectId: string) => {
      entered.push(projectId);
      await gate;
      return okResult();
    });
    const { runSyncPass } = await load();

    const pending = Promise.all([runSyncPass("a"), runSyncPass("b")]);
    await settle();
    expect(entered.slice().sort()).toEqual(["a", "b"]);
    release();
    await pending;
  });
});

describe("startPrSyncDriver", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "setInterval", "Date"] });
    vi.setSystemTime(new Date("2026-08-01T00:00:00.000Z"));
  });

  async function started() {
    const driver = await load();
    driver.startPrSyncDriver();
    await settle();
    return driver;
  }

  function publishIssue(driver: Awaited<ReturnType<typeof load>>, id: string): void {
    driver.publishFrame(driver.ISSUES_TOPIC, {
      event: { type: "change", id, scope: "issue" },
      persist: false,
    });
  }

  it("passes each Project with a workspace at boot and again on the cadence", async () => {
    project("b");
    project("a");
    project("bare", {});
    const { PR_SYNC_CADENCE_MS } = await started();

    expect(reconcileProjectPrs.mock.calls.map((call) => call[0]).sort()).toEqual([
      "a",
      "b",
    ]);

    await vi.advanceTimersByTimeAsync(PR_SYNC_CADENCE_MS - 1);
    await settle();
    expect(reconcileProjectPrs).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(1);
    await settle();
    expect(reconcileProjectPrs).toHaveBeenCalledTimes(4);
  });

  it("retries a failed pass on the next tick without extra backoff", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    project("p");
    reconcileProjectPrs.mockResolvedValue({ ...okResult(), error: "gh down" });
    const { PR_SYNC_CADENCE_MS, prSyncStatus } = await started();

    expect(prSyncStatus("p").lastError?.message).toBe("gh down");
    expect(error).toHaveBeenCalledWith("pr sync failed for p: gh down");

    reconcileProjectPrs.mockResolvedValue(okResult());
    await vi.advanceTimersByTimeAsync(PR_SYNC_CADENCE_MS);
    await settle();

    expect(reconcileProjectPrs).toHaveBeenCalledTimes(2);
    expect(prSyncStatus("p").lastSyncedAt).toBe("2026-08-01T00:05:00.000Z");
    expect(prSyncStatus("p").lastError).toBeUndefined();
  });

  it("does not start a second cadence when started twice", async () => {
    project("p");
    const driver = await started();
    driver.startPrSyncDriver();
    await vi.advanceTimersByTimeAsync(driver.PR_SYNC_CADENCE_MS);
    await settle();
    expect(reconcileProjectPrs).toHaveBeenCalledTimes(2);
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

  it("debounces a Story becoming ready to land into one pass", async () => {
    project("p");
    story("ship", "p");
    task("t", "ship", "todo");
    const driver = await started();
    expect(reconcileProjectPrs).toHaveBeenCalledTimes(1);

    task("t", "ship", "done");
    publishIssue(driver, "t");
    task("t", "ship", "done");
    publishIssue(driver, "t");
    await vi.advanceTimersByTimeAsync(driver.PR_SYNC_STORE_DEBOUNCE_MS - 1);
    await settle();
    expect(reconcileProjectPrs).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    await settle();
    expect(reconcileProjectPrs).toHaveBeenCalledTimes(2);
    expect(reconcileProjectPrs).toHaveBeenLastCalledWith("p");
  });

  it("passes when a Story gains a prUrl and ignores a replaced prUrl", async () => {
    project("p");
    story("ship", "p");
    task("t", "ship", "todo");
    const driver = await started();

    story("ship", "p", { prUrl: "https://github.com/acme/widgets/pull/7" });
    publishIssue(driver, "ship");
    await vi.advanceTimersByTimeAsync(driver.PR_SYNC_STORE_DEBOUNCE_MS);
    await settle();
    expect(reconcileProjectPrs).toHaveBeenCalledTimes(2);

    story("ship", "p", { prUrl: "https://github.com/acme/widgets/pull/8" });
    publishIssue(driver, "ship");
    await vi.advanceTimersByTimeAsync(driver.PR_SYNC_STORE_DEBOUNCE_MS);
    await settle();
    expect(reconcileProjectPrs).toHaveBeenCalledTimes(2);
  });

  it("ignores an edit that does not newly ready a Story or add a prUrl", async () => {
    project("p");
    story("ship", "p", { title: "before" });
    task("t", "ship", "todo");
    const driver = await started();

    story("ship", "p", { title: "after" });
    publishIssue(driver, "ship");
    await vi.advanceTimersByTimeAsync(driver.PR_SYNC_STORE_DEBOUNCE_MS);
    await settle();
    expect(reconcileProjectPrs).toHaveBeenCalledTimes(1);
  });

  it("ignores comment frames", async () => {
    project("p");
    story("ship", "p");
    const driver = await started();
    driver.publishFrame(driver.ISSUES_TOPIC, {
      event: { type: "change", id: "ship", scope: "comments" },
      persist: false,
    });
    await vi.advanceTimersByTimeAsync(driver.PR_SYNC_STORE_DEBOUNCE_MS);
    await settle();
    expect(reconcileProjectPrs).toHaveBeenCalledTimes(1);
  });

  it("debounces each Project on its own", async () => {
    project("a");
    project("b");
    story("sa", "a");
    story("sb", "b");
    task("ta", "sa", "todo");
    task("tb", "sb", "todo");
    const driver = await started();
    expect(reconcileProjectPrs).toHaveBeenCalledTimes(2);

    task("ta", "sa", "done");
    publishIssue(driver, "ta");
    await vi.advanceTimersByTimeAsync(driver.PR_SYNC_STORE_DEBOUNCE_MS / 2);
    task("tb", "sb", "done");
    publishIssue(driver, "tb");
    await vi.advanceTimersByTimeAsync(driver.PR_SYNC_STORE_DEBOUNCE_MS / 2);
    await settle();

    const ids = reconcileProjectPrs.mock.calls.map((call) => call[0]);
    expect(ids).toEqual(["a", "b", "a"]);

    await vi.advanceTimersByTimeAsync(driver.PR_SYNC_STORE_DEBOUNCE_MS / 2);
    await settle();
    expect(reconcileProjectPrs.mock.calls.map((call) => call[0])).toEqual([
      "a",
      "b",
      "a",
      "b",
    ]);
  });

  it("does not pass a Project that has no workspace when its Story becomes ready", async () => {
    project("bare", {});
    story("ship", "bare");
    task("t", "ship", "todo");
    const driver = await started();
    expect(reconcileProjectPrs).not.toHaveBeenCalled();

    task("t", "ship", "done");
    publishIssue(driver, "t");
    await vi.advanceTimersByTimeAsync(driver.PR_SYNC_STORE_DEBOUNCE_MS);
    await settle();
    expect(reconcileProjectPrs).not.toHaveBeenCalled();
  });
});
