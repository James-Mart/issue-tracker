import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentStreamEvent } from "./agent-sdk.js";
import {
  createFakeAgentSdk,
  FAKE_AGENT_ID,
  type FakeAgentHandle,
  type FakeAgentSdk,
} from "./agent-sdk.fake.js";
import {
  conversationDir,
  load,
  storeDir,
  useAgentSessionsTestFixtures,
} from "./agent-sessions.test-harness.js";

useAgentSessionsTestFixtures();

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});

afterEach(() => {
  vi.useRealTimers();
});

/**
 * Let already-started teardown / pump work run without moving the fake clock.
 * Backs "has not happened" assertions; "has happened" ones use {@link until}.
 */
async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

async function until(condition: () => boolean): Promise<void> {
  for (let i = 0; i < 1000 && !condition(); i++) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  expect(condition()).toBe(true);
}

function disposed(handle: FakeAgentHandle | undefined): () => boolean {
  return () => handle?.disposed === true;
}

async function idleTimeout(): Promise<number> {
  const { AGENT_SESSION_IDLE_TIMEOUT_MS } = await import("./agent-sessions.js");
  return AGENT_SESSION_IDLE_TIMEOUT_MS;
}

async function runOnce(
  sessions: { sendPrompt: (id: string, o: { prompt: string }) => Promise<unknown> },
  conversationId: string,
  prompt: string,
): Promise<void> {
  const result = (await sessions.sendPrompt(conversationId, { prompt })) as
    | { ok: true; run: { wait(): Promise<unknown> } }
    | { ok: false };
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  await result.run.wait();
  await settle();
}

const NESTED_CONTENT: AgentStreamEvent = {
  kind: "message",
  message: {
    type: "assistant",
    agent_id: "nested",
    run_id: "nested-run",
    message: { role: "assistant", content: [{ type: "text", text: "Working." }] },
  },
};

describe("agent sessions idle teardown", () => {
  it("tears down a session once it has been idle for the timeout", async () => {
    const { createConversation, createAgentSessions } = await load();
    const timeout = await idleTimeout();
    const caches = await import("./agent-state-caches.js");
    const evictSpy = vi.spyOn(caches, "evictConversationStoreCaches");
    const append = await import("./jsonl-append.js");
    const releaseSpy = vi.spyOn(append, "releasePreparedAppendPaths");
    const stack = await import("./agent-stack.js");
    const stopSpy = vi.spyOn(stack, "stopAgentStack");
    const fake = createFakeAgentSdk();
    const sessions = createAgentSessions(fake);
    const meta = await createConversation({
      title: "Idle",
      projectId: "platform",
      model: "auto",
    });

    await runOnce(sessions, meta.id, "go");
    evictSpy.mockClear();
    releaseSpy.mockClear();
    stopSpy.mockClear();

    await vi.advanceTimersByTimeAsync(timeout - 1);
    await settle();
    expect(fake.handles[0]?.disposed).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await until(() => stopSpy.mock.calls.length > 0);
    expect(fake.handles[0]?.disposed).toBe(true);
    expect(evictSpy).toHaveBeenCalledWith(storeDir(meta.id));
    expect(releaseSpy).toHaveBeenCalledWith(conversationDir(meta.id));
    expect(stopSpy).toHaveBeenCalledWith(meta.id);
    evictSpy.mockRestore();
    releaseSpy.mockRestore();
    stopSpy.mockRestore();
  });

  it("resumes the stored agent id on the next prompt and leaves on-disk state untouched", async () => {
    const { createConversation, readConversation, createAgentSessions } =
      await load();
    const timeout = await idleTimeout();
    const fake = createFakeAgentSdk();
    const sessions = createAgentSessions(fake);
    const meta = await createConversation({
      title: "Resume after idle",
      projectId: "platform",
      model: "auto",
    });

    await runOnce(sessions, meta.id, "first");
    const before = readConversation(meta.id);
    expect(before.meta.agentId).toBe(FAKE_AGENT_ID);

    await vi.advanceTimersByTimeAsync(timeout);
    await until(disposed(fake.handles[0]));
    expect(readConversation(meta.id)).toEqual(before);

    await runOnce(sessions, meta.id, "second");
    expect(fake.created).toHaveLength(1);
    expect(fake.resumed).toEqual([
      expect.objectContaining({
        agentId: FAKE_AGENT_ID,
        storeDir: storeDir(meta.id),
      }),
    ]);
    expect(fake.handles[1]?.sends).toEqual([
      { message: "second", options: {} },
    ]);
  });

  it("restarts the clock when a prompt starts and holds it while the run is live", async () => {
    const { createConversation, createAgentSessions } = await load();
    const timeout = await idleTimeout();
    let release!: () => void;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fake = createFakeAgentSdk({ sendScript: [{}, { hold }] });
    const sessions = createAgentSessions(fake);
    const meta = await createConversation({
      title: "Clock reset",
      projectId: "platform",
      model: "auto",
    });

    await runOnce(sessions, meta.id, "first");
    await vi.advanceTimersByTimeAsync(timeout / 2);

    const second = await sessions.sendPrompt(meta.id, { prompt: "second" });
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    await vi.advanceTimersByTimeAsync(timeout * 2);
    await settle();
    expect(fake.handles[0]?.disposed).toBe(false);
    expect(sessions.getActiveRun(meta.id)).toBeDefined();

    release();
    await second.run.wait();
    await settle();
    await vi.advanceTimersByTimeAsync(timeout - 1);
    await settle();
    expect(fake.handles[0]?.disposed).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await until(disposed(fake.handles[0]));
  });

  it("restarts the clock when a send never starts a run", async () => {
    const { createConversation, createAgentSessions } = await load();
    const { CursorAgentError } = await import("./agent-sdk.js");
    const timeout = await idleTimeout();
    const fake = createFakeAgentSdk({
      sendScript: [{}, { sendError: new CursorAgentError("Invalid API key") }],
    });
    const sessions = createAgentSessions(fake);
    const meta = await createConversation({
      title: "Send refused",
      projectId: "platform",
      model: "auto",
    });

    await runOnce(sessions, meta.id, "first");
    await vi.advanceTimersByTimeAsync(timeout / 2);
    const refused = await sessions.sendPrompt(meta.id, { prompt: "second" });
    expect(refused.ok).toBe(false);

    await vi.advanceTimersByTimeAsync(timeout - 1);
    await settle();
    expect(fake.handles[0]?.disposed).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await until(disposed(fake.handles[0]));
  });

  it("defers teardown while a nested delegation is in flight", async () => {
    const { createConversation, createAgentSessions } = await load();
    const timeout = await idleTimeout();
    let releaseNested!: () => void;
    const holdAfterStream = new Promise<void>((resolve) => {
      releaseNested = resolve;
    });
    const fake = createFakeAgentSdk({
      sendScript: [{}, { stream: [NESTED_CONTENT], holdAfterStream }],
    });
    const sessions = createAgentSessions(fake);
    const meta = await createConversation({
      title: "Nested in flight",
      projectId: "platform",
      model: "auto",
    });

    await runOnce(sessions, meta.id, "go");
    const delegate = fake.created[0]?.customTools?.delegate;
    expect(delegate).toBeDefined();
    if (!delegate) return;
    const nested = delegate.execute(
      { role: "issue-tracker-research", prompt: "look" },
      {},
    );
    await until(() => fake.handles.length === 2);

    await vi.advanceTimersByTimeAsync(timeout);
    await settle();
    expect(fake.handles[0]?.disposed).toBe(false);
    expect(fake.handles[1]?.cancelled).toBe(false);

    releaseNested();
    expect(await nested).toMatchObject({ ok: true });
    await vi.advanceTimersByTimeAsync(timeout);
    await until(disposed(fake.handles[0]));
  });

  it("ends a prompt racing a teardown with exactly one live session", async () => {
    const { createConversation, createAgentSessions } = await load();
    const timeout = await idleTimeout();
    const fake = createFakeAgentSdk();
    const sessions = createAgentSessions(fake);
    const meta = await createConversation({
      title: "Race",
      projectId: "platform",
      model: "auto",
    });

    await runOnce(sessions, meta.id, "first");
    let finishDispose!: () => void;
    const original = fake.handles[0]!;
    original[Symbol.asyncDispose] = () =>
      new Promise<void>((resolve) => {
        finishDispose = () => {
          original.disposed = true;
          resolve();
        };
      });

    await vi.advanceTimersByTimeAsync(timeout);
    await settle();
    // Concurrent prompts contend the orphan-scrub lock, which retries on a timer.
    vi.useRealTimers();
    const racing = Promise.all([
      sessions.sendPrompt(meta.id, { prompt: "a" }),
      sessions.sendPrompt(meta.id, { prompt: "b" }),
    ]);
    await settle();
    expect(fake.resumed).toHaveLength(0);

    finishDispose();
    const results = await racing;
    expect(results.every((r) => r.ok)).toBe(true);
    for (const r of results) if (r.ok) await r.run.wait();

    expect(fake.resumed).toHaveLength(1);
    expect(fake.handles).toHaveLength(2);
    expect(fake.handles[0]?.disposed).toBe(true);
    expect(fake.handles[1]?.disposed).toBe(false);
    expect(fake.handles[1]?.sends.map((s) => s.message)).toEqual(["a", "b"]);
  });

  it("dispose during an idle teardown waits for it and stops the stack once", async () => {
    const { createConversation, createAgentSessions } = await load();
    const timeout = await idleTimeout();
    const stack = await import("./agent-stack.js");
    const stopSpy = vi.spyOn(stack, "stopAgentStack");
    const fake = createFakeAgentSdk();
    const sessions = createAgentSessions(fake);
    const meta = await createConversation({
      title: "Delete while idle teardown runs",
      projectId: "platform",
      model: "auto",
    });

    await runOnce(sessions, meta.id, "go");
    let finishDispose!: () => void;
    const original = fake.handles[0]!;
    original[Symbol.asyncDispose] = () =>
      new Promise<void>((resolve) => {
        finishDispose = resolve;
      });
    stopSpy.mockClear();

    await vi.advanceTimersByTimeAsync(timeout);
    await settle();
    let deleted = false;
    const deleting = sessions.dispose(meta.id).then(() => {
      deleted = true;
    });
    await settle();
    expect(deleted).toBe(false);

    finishDispose();
    await deleting;
    expect(stopSpy).toHaveBeenCalledTimes(1);
    stopSpy.mockRestore();
  });

  it("releases tool results and stream state when the session goes idle", async () => {
    const { createConversation, readConversation, createAgentSessions } =
      await load();
    const { coalesceCustomTools } = await import("./custom-tool-coalesce.js");
    const { publishFrame, getFramesSince } = await import(
      "./conversation-stream.js"
    );
    const timeout = await idleTimeout();
    const fake = createFakeAgentSdk();
    const sessions = createAgentSessions(fake);
    const meta = await createConversation({
      title: "Release on idle",
      projectId: "platform",
      model: "auto",
    });

    await runOnce(sessions, meta.id, "go");
    const persisted = readConversation(meta.id).transcript.at(-1)?.seq ?? 0;
    let runs = 0;
    const wrapped = coalesceCustomTools(
      {
        delegate: {
          execute: async () => {
            runs += 1;
            return { value: "stored" };
          },
        },
        delegations: {
          execute: async () => {
            runs += 1;
            return { value: "nested" };
          },
        },
      },
      meta.id,
    );
    await wrapped.delegate!.execute({}, { toolCallId: "root-call" });
    await wrapped.delegations!.execute({}, { toolCallId: "nested-call" });

    const live: {
      type: "run";
      status: "started";
      runId: string;
      seq?: number;
    } = {
      type: "run",
      status: "started",
      runId: "live",
    };
    publishFrame(meta.id, { event: live, persist: false });
    expect(live.seq).toBeGreaterThan(persisted);

    await vi.advanceTimersByTimeAsync(timeout);
    await until(disposed(fake.handles[0]));

    expect(getFramesSince(meta.id, persisted)).toEqual({
      resetRequired: false,
      frames: [],
    });
    expect(getFramesSince(meta.id, live.seq!)).toEqual({ resetRequired: true });

    await wrapped.delegate!.execute({}, { toolCallId: "root-call" });
    await wrapped.delegations!.execute({}, { toolCallId: "nested-call" });
    expect(runs).toBe(4);

    const next: { type: "pending"; text: string; seq?: number } = {
      type: "pending",
      text: "after idle",
    };
    publishFrame(meta.id, { event: next, persist: false });
    expect(next.seq).toBe(persisted + 1);
    const caughtUp = getFramesSince(meta.id, persisted);
    expect(caughtUp.resetRequired).toBe(false);
    if (caughtUp.resetRequired) return;
    expect(caughtUp.frames.map((frame) => frame.event.seq)).toEqual([
      persisted + 1,
    ]);
  });

  it("does not hold the process open with the idle timer", async () => {
    const { createConversation, createAgentSessions } = await load();
    const timeout = await idleTimeout();
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const fake = createFakeAgentSdk();
    const sessions = createAgentSessions(fake);
    const meta = await createConversation({
      title: "Unref",
      projectId: "platform",
      model: "auto",
    });

    await runOnce(sessions, meta.id, "go");
    const idleCall = setTimeoutSpy.mock.calls.findIndex(
      ([, ms]) => ms === timeout,
    );
    expect(idleCall).toBeGreaterThanOrEqual(0);
    const timer = setTimeoutSpy.mock.results[idleCall]?.value as NodeJS.Timeout;
    expect(timer.hasRef()).toBe(false);
    setTimeoutSpy.mockRestore();
  });
});
