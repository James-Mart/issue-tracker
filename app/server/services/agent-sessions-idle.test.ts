import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentStreamEvent } from "./agent-sdk.js";
import { createFakeAgentSdk, type FakeAgentHandle } from "./agent-sdk.fake.js";
import { load, useAgentSessionsTestFixtures } from "./agent-sessions.test-harness.js";

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
});
