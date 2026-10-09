import { describe, expect, it } from "vitest";
import {
  buildScriptedStreamWithAgentIdHint,
  createFakeAgentSdk,
  FAKE_RUN_ID,
  PRIMARY_TOOL_CALL_ID,
  TASK_TOOL_CALL_ID,
} from "./agent-sdk.fake.js";
import { load, useAgentSessionsTestFixtures } from "./agent-sessions.test-harness.js";
import type { ConversationFrame } from "./conversation-stream.js";

useAgentSessionsTestFixtures();

describe("agent sessions streaming", () => {
  it("live tap delivers deltas/transitions/nested frames while disk holds durable transcript events", async () => {
    const {
      createConversation,
      readConversation,
      createAgentSessions,
      subscribeFrames,
    } = await load();

    // Hold the stream so the subscriber attaches mid-run, before any event is
    // pumped, and deterministically observes every live frame.
    let release!: () => void;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fake = createFakeAgentSdk({
      hold,
      stream: buildScriptedStreamWithAgentIdHint(),
    });
    const sessions = createAgentSessions(fake);

    const meta = await createConversation({
      title: "Live tap",
      projectId: "platform",
      model: "composer-2.5",
    });

    const result = await sessions.sendPrompt(meta.id, { prompt: "go" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const frames: ConversationFrame[] = [];
    const unsubscribe = subscribeFrames(meta.id, (frame) => {
      frames.push(frame);
    });
    release();
    await result.run.wait();
    unsubscribe();

    const isAssistant = (
      f: ConversationFrame,
    ): f is ConversationFrame & { event: { type: "assistant" } } =>
      f.event.type === "assistant";
    const isToolCall = (
      f: ConversationFrame,
    ): f is ConversationFrame & { event: { type: "tool_call" } } =>
      f.event.type === "tool_call";
    const isSubagent = (
      f: ConversationFrame,
    ): f is ConversationFrame & { event: { type: "subagent_update" } } =>
      f.event.type === "subagent_update";

    // Incremental assistant delta reaches subscribers but never persists.
    const assistantLive = frames
      .filter(isAssistant)
      .filter((f) => !f.persist);
    expect(assistantLive.map((f) => f.event.text)).toEqual(["On it."]);

    // tool_call running -> completed transition for the primary call.
    const primaryStatuses = frames
      .filter(isToolCall)
      .filter((f) => f.event.callId === PRIMARY_TOOL_CALL_ID)
      .map((f) => ({ status: f.event.status, persist: f.persist }));
    expect(primaryStatuses).toEqual([
      { status: "running", persist: true },
      { status: "completed", persist: true },
    ]);

    // Nested subagent_update frames — all tagged with the parent Task call —
    // include the live-only text/thinking deltas; running nested tool_call persists.
    const nested = frames.filter(isSubagent);
    expect(nested.length).toBeGreaterThan(0);
    expect(
      nested.every((f) => f.event.parentCallId === TASK_TOOL_CALL_ID),
    ).toBe(true);
    const nestedLive = nested
      .filter((f) => !f.persist)
      .map(({ event: { step } }) => ({
        kind: step.kind,
        status: "status" in step ? step.status : undefined,
      }));
    expect(nestedLive).toEqual([
      { kind: "text", status: undefined },
      { kind: "thinking", status: undefined },
    ]);
    const nestedRunningTool = nested.find(
      (f) =>
        f.event.step.kind === "tool_call" &&
        f.event.step.status === "running",
    );
    expect(nestedRunningTool?.persist).toBe(true);

    // Disk holds coalesced assistant/thinking, every top-level tool_call frame
    // (running and terminal), and finalized nested subagent_update events.
    const { transcript } = readConversation(meta.id);
    expect(transcript.map((e) => e.type)).toEqual([
      "assistant",
      "thinking",
      "tool_call",
      "tool_call",
      "task",
      "status",
      "usage",
      "request",
      "tool_call",
      "subagent_update",
      "subagent_update",
      "subagent_update",
      "subagent_update",
      "subagent_update",
      "subagent_update",
      "tool_call",
    ]);
    expect(transcript[0]).toMatchObject({ type: "assistant", text: "On it." });
    expect(
      transcript.flatMap((e) =>
        e.type === "tool_call" && e.callId === PRIMARY_TOOL_CALL_ID ? [e.status] : [],
      ),
    ).toEqual(["running", "completed"]);
    expect(
      transcript.flatMap((e) =>
        e.type === "tool_call" && e.callId === TASK_TOOL_CALL_ID ? [e.status] : [],
      ),
    ).toEqual(["running", "completed"]);
  });

  it("cancel cascades to in-flight and queued nested delegations before the parent settles", async () => {
    const {
      createConversation,
      createAgentSessions,
      conversationDelegationOutstandingForTests,
      MAX_CONCURRENT_DELEGATIONS_PER_CONVERSATION,
    } = await load();
    let release!: () => void;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fake = createFakeAgentSdk({ hold, stream: [] });
    const sessions = createAgentSessions(fake);

    const meta = await createConversation({
      title: "Cascade cancel",
      projectId: "platform",
      model: "auto",
    });
    const result = await sessions.sendPrompt(meta.id, { prompt: "go" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    await Promise.resolve();
    const delegate = fake.created[0]?.customTools?.delegate;
    expect(delegate).toBeDefined();
    if (!delegate) return;

    const role = "issue-tracker-research";
    const cap = MAX_CONCURRENT_DELEGATIONS_PER_CONVERSATION;
    const nested = Array.from({ length: cap }, (_, i) =>
      delegate.execute({ role, prompt: `nested-${i}` }, {}),
    );
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline && fake.handles.length < cap + 1) {
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(fake.handles.length).toBe(cap + 1);

    const queued = delegate.execute({ role, prompt: "queued" }, {});
    await new Promise((r) => setTimeout(r, 50));
    expect(fake.handles.length).toBe(cap + 1);
    expect(conversationDelegationOutstandingForTests(meta.id).queued).toBe(1);

    // Nested cancel + queue drop run inside cancel() before parent handle.cancel().
    expect(await sessions.cancel(meta.id)).toBe(true);

    await expect(queued).rejects.toThrow("delegate: conversation cancelled");
    await Promise.all(
      nested.map(async (p) => {
        const result = await p;
        expect(result).toMatchObject({
          ok: false,
          failureClass: "cancelled",
        });
      }),
    );
    for (let i = 1; i <= cap; i++) {
      expect(fake.handles[i]?.cancelled).toBe(true);
    }
    expect(conversationDelegationOutstandingForTests(meta.id)).toEqual({
      inFlight: 0,
      queued: 0,
      nestedTracked: 0,
    });

    expect(fake.handles[0]?.cancelled).toBe(true);
    expect(await result.run.wait()).toEqual({
      id: FAKE_RUN_ID,
      status: "cancelled",
    });
    release();
    await sessions.disposeAll();
  });
});
