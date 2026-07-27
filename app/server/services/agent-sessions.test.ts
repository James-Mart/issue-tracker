import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join, dirname } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CursorAgentError } from "./agent-sdk.js";
import {
  buildScriptedStreamWithAgentIdHint,
  createFakeAgentSdk,
  FAKE_AGENT_ID,
  FAKE_RUN_ID,
  NESTED_AGENT_ID,
  PRIMARY_TOOL_CALL_ID,
  TASK_TOOL_CALL_ID,
} from "./agent-sdk.fake.js";
import type { ConversationFrame } from "./conversation-stream.js";

const AT = "2026-07-24T12:00:00.000Z";

let issuesRoot: string;
let workspaceDir: string;

function writeIssue(id: string, body: Record<string, unknown>): void {
  mkdirSync(join(issuesRoot, id), { recursive: true });
  writeFileSync(join(issuesRoot, id, "issue.json"), JSON.stringify({ id, ...body }));
}

beforeEach(() => {
  issuesRoot = mkdtempSync(join(tmpdir(), "issue-tracker-sessions-"));
  workspaceDir = mkdtempSync(join(tmpdir(), "issue-session-ws-"));
  mkdirSync(join(workspaceDir, ".git"));
  vi.resetModules();
  vi.stubEnv("ISSUES_DIR", issuesRoot);
  writeIssue("platform", {
    kind: "project",
    title: "Platform",
    workspace: workspaceDir,
    createdAt: AT,
    updatedAt: AT,
  });
});

afterEach(async () => {
  const { resetDelegationConcurrencyForTests } = await import(
    "./delegate-tool.js"
  );
  resetDelegationConcurrencyForTests();
  vi.unstubAllEnvs();
  rmSync(issuesRoot, { recursive: true, force: true });
  rmSync(workspaceDir, { recursive: true, force: true });
});

async function load() {
  const conversations = await import("./conversations.js");
  const { createAgentSessions } = await import("./agent-sessions.js");
  const { subscribeFrames } = await import("./conversation-stream.js");
  const {
    conversationDelegationOutstandingForTests,
    MAX_CONCURRENT_DELEGATIONS_PER_CONVERSATION,
    resetDelegationConcurrencyForTests,
  } = await import("./delegate-tool.js");
  return {
    ...conversations,
    createAgentSessions,
    subscribeFrames,
    conversationDelegationOutstandingForTests,
    MAX_CONCURRENT_DELEGATIONS_PER_CONVERSATION,
    resetDelegationConcurrencyForTests,
  };
}

describe("agent sessions manager", () => {
  it("creates an agent when meta has no agentId and persists agentId after create", async () => {
    const { createConversation, readConversation, createAgentSessions } =
      await load();
    const fake = createFakeAgentSdk({
      stream: buildScriptedStreamWithAgentIdHint(),
    });
    const sessions = createAgentSessions(fake);

    const meta = await createConversation({
      title: "First turn",
      projectId: "platform",
      model: "composer-2.5",
    });
    expect(meta.agentId).toBeUndefined();

    const result = await sessions.sendPrompt(meta.id, { prompt: "go" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.run.id).toBe(FAKE_RUN_ID);
    expect(sessions.getActiveRun(meta.id)?.id).toBe(FAKE_RUN_ID);

    const waited = await result.run.wait();
    expect(waited).toEqual({ id: FAKE_RUN_ID, status: "finished" });
    expect(sessions.getActiveRun(meta.id)).toBeUndefined();

    expect(fake.created).toHaveLength(1);
    expect(fake.created[0]).toMatchObject({
      cwd: workspaceDir,
      model: { id: "composer-2.5" },
      storeDir: join(dirname(issuesRoot), "conversations", meta.id, "agent-state"),
    });
    expect(fake.created[0]?.customTools?.delegate).toBeDefined();
    expect(fake.created[0]?.agents).toEqual(expect.any(Object));
    expect(fake.resumed).toHaveLength(0);
    expect(fake.handles[0]?.sends).toEqual([
      { prompt: "go", options: {} },
    ]);

    expect(readConversation(meta.id).meta.agentId).toBe(FAKE_AGENT_ID);
  });

  it("resumes when meta.agentId is set", async () => {
    const { createConversation, updateMeta, createAgentSessions } = await load();
    const fake = createFakeAgentSdk();
    const sessions = createAgentSessions(fake);

    const meta = await createConversation({
      title: "Resume me",
      projectId: "platform",
      model: "auto",
      agentId: "agent-existing",
    });
    // Ensure meta carries agentId (createConversation also accepts it).
    expect(meta.agentId).toBe("agent-existing");
    await updateMeta(meta.id, { agentId: "agent-existing" });

    const result = await sessions.sendPrompt(meta.id, {
      prompt: "again",
      model: "composer-2.5",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    await result.run.wait();

    expect(fake.created).toHaveLength(0);
    expect(fake.resumed).toEqual([
      {
        agentId: "agent-existing",
        storeDir: join(
          dirname(issuesRoot),
          "conversations",
          meta.id,
          "agent-state",
        ),
        options: {
          // The Project's workspace, not the server's own working directory:
          // the SDK scopes the stored agent to the workspace it ran in, so
          // resuming under anything else reports it as missing.
          cwd: workspaceDir,
          model: { id: "auto" },
          agents: expect.any(Object),
          customTools: expect.objectContaining({
            delegate: expect.any(Object),
          }),
        },
      },
    ]);
    expect(fake.handles[0]?.sends).toEqual([
      { prompt: "again", options: { model: { id: "composer-2.5" } } },
    ]);
  });

  it("creates a fresh agent when resume fails, records an error event, and continues the send", async () => {
    const {
      createConversation,
      readConversation,
      appendEvent,
      createAgentSessions,
    } = await load();
    const fake = createFakeAgentSdk({
      resumeError: new Error("agent not found in store"),
      stream: buildScriptedStreamWithAgentIdHint(),
    });
    const sessions = createAgentSessions(fake);

    const meta = await createConversation({
      title: "Stale agent",
      projectId: "platform",
      model: "composer-2.5",
      agentId: "agent-stale",
    });
    await appendEvent(meta.id, { type: "prompt", text: "earlier turn" });
    await appendEvent(meta.id, {
      type: "assistant",
      text: "Already answered.",
    });
    const priorTranscript = readConversation(meta.id).transcript;

    const result = await sessions.sendPrompt(meta.id, { prompt: "continue" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    await result.run.wait();

    expect(fake.resumed).toEqual([
      {
        agentId: "agent-stale",
        storeDir: join(
          dirname(issuesRoot),
          "conversations",
          meta.id,
          "agent-state",
        ),
        options: {
          cwd: workspaceDir,
          model: { id: "composer-2.5" },
          agents: expect.any(Object),
          customTools: expect.objectContaining({
            delegate: expect.any(Object),
          }),
        },
      },
    ]);
    expect(fake.created).toHaveLength(1);
    expect(fake.created[0]).toMatchObject({
      cwd: workspaceDir,
      model: { id: "composer-2.5" },
      storeDir: join(
        dirname(issuesRoot),
        "conversations",
        meta.id,
        "agent-state",
      ),
    });
    expect(fake.created[0]?.customTools?.delegate).toBeDefined();
    expect(readConversation(meta.id).meta.agentId).toBe(FAKE_AGENT_ID);
    expect(fake.handles[0]?.sends).toEqual([{ prompt: "continue", options: {} }]);

    const { transcript } = readConversation(meta.id);
    expect(transcript.slice(0, priorTranscript.length)).toEqual(priorTranscript);
    const errorEvent = transcript.find((e) => e.type === "error");
    expect(errorEvent).toMatchObject({
      type: "error",
      // The reason travels with the notice: restarting is otherwise
      // indistinguishable from a fresh conversation, which is how a resume
      // that fails every time stays invisible.
      message:
        "The previous agent session could not be resumed; earlier agent-side " +
        "context was lost. Reason: agent not found in store",
    });
    expect(transcript.at(-1)?.type).not.toBe("error");
  });

  it("persists finalized transcript events including nested subagent_update", async () => {
    const { createConversation, readConversation, createAgentSessions } =
      await load();
    const fake = createFakeAgentSdk({
      stream: buildScriptedStreamWithAgentIdHint(),
    });
    const sessions = createAgentSessions(fake);

    const meta = await createConversation({
      title: "Transcript",
      projectId: "platform",
      model: "composer-2.5",
    });

    const result = await sessions.sendPrompt(meta.id, { prompt: "go" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    await result.run.wait();

    const { transcript } = readConversation(meta.id);
    const types = transcript.map((e) => e.type);
    expect(types).toEqual([
      "assistant",
      "thinking",
      "tool_call",
      "task",
      "status",
      "usage",
      "request",
      "subagent_update",
      "subagent_update",
      "subagent_update",
      "subagent_update",
      "subagent_update",
      "tool_call",
    ]);

    expect(transcript[0]).toMatchObject({
      type: "assistant",
      text: "On it.",
    });
    expect(transcript[2]).toMatchObject({
      type: "tool_call",
      callId: PRIMARY_TOOL_CALL_ID,
      name: "read",
      status: "completed",
    });
    // Running tool_call frames are not persisted — only the terminal Task call.
    expect(
      transcript.filter(
        (e) => e.type === "tool_call" && e.callId === TASK_TOOL_CALL_ID,
      ),
    ).toHaveLength(1);

    const nested = transcript.filter((e) => e.type === "subagent_update");
    expect(nested.every((e) => e.parentCallId === TASK_TOOL_CALL_ID)).toBe(true);
    expect(nested.map((e) => e.step.kind)).toEqual([
      "text",
      "thinking",
      "tool_call",
      "step",
      "step",
    ]);
    expect(nested[0]).toMatchObject({
      step: { kind: "text", text: "Reading the file." },
    });
    expect(nested[1]).toMatchObject({
      step: { kind: "thinking", text: "Considering options." },
    });
    expect(nested[2]).toMatchObject({
      step: {
        kind: "tool_call",
        callId: "nested-shell-1",
        name: "shell",
        status: "completed",
      },
    });

    const taskDone = transcript.find(
      (e) => e.type === "tool_call" && e.callId === TASK_TOOL_CALL_ID,
    );
    expect(taskDone).toMatchObject({
      type: "tool_call",
      status: "completed",
      resultAgentId: NESTED_AGENT_ID,
    });
  });

  it("live tap delivers deltas/transitions/nested frames while disk holds only finalized events", async () => {
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
      { status: "running", persist: false },
      { status: "completed", persist: true },
    ]);

    // Nested subagent_update frames — all tagged with the parent Task call —
    // include the live-only text/thinking/tool-call-running deltas.
    const nested = frames.filter(isSubagent);
    expect(nested.length).toBeGreaterThan(0);
    expect(
      nested.every((f) => f.event.parentCallId === TASK_TOOL_CALL_ID),
    ).toBe(true);
    const nestedLive = nested
      .filter((f) => !f.persist)
      .map((f) => ({ kind: f.event.step.kind, status: f.event.step.status }));
    expect(nestedLive).toEqual([
      { kind: "text", status: undefined },
      { kind: "thinking", status: undefined },
      { kind: "tool_call", status: "running" },
    ]);

    // Persistence semantics unchanged: disk holds only the finalized events in
    // order — one coalesced assistant, one terminal tool_call per call_id, and
    // the finalized nested subagent_update events.
    const { transcript } = readConversation(meta.id);
    expect(transcript.map((e) => e.type)).toEqual([
      "assistant",
      "thinking",
      "tool_call",
      "task",
      "status",
      "usage",
      "request",
      "subagent_update",
      "subagent_update",
      "subagent_update",
      "subagent_update",
      "subagent_update",
      "tool_call",
    ]);
    expect(transcript[0]).toMatchObject({ type: "assistant", text: "On it." });
    expect(
      transcript.filter(
        (e) => e.type === "tool_call" && e.callId === PRIMARY_TOOL_CALL_ID,
      ),
    ).toHaveLength(1);
    expect(
      transcript.filter(
        (e) => e.type === "tool_call" && e.callId === TASK_TOOL_CALL_ID,
      ),
    ).toHaveLength(1);
  });

  it("a throwing live subscriber disrupts neither persistence nor other subscribers", async () => {
    const {
      createConversation,
      readConversation,
      createAgentSessions,
      subscribeFrames,
    } = await load();

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
      title: "Faulty subscriber",
      projectId: "platform",
      model: "composer-2.5",
    });

    const result = await sessions.sendPrompt(meta.id, { prompt: "go" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // A subscriber that throws on every frame (e.g. a broken SSE writer).
    let thrown = 0;
    const unsubBad = subscribeFrames(meta.id, () => {
      thrown += 1;
      throw new Error("broken SSE writer");
    });
    // A healthy subscriber that must keep receiving frames regardless.
    const healthy: ConversationFrame[] = [];
    const unsubGood = subscribeFrames(meta.id, (frame) => {
      healthy.push(frame);
    });

    release();
    // The pump must settle normally — a listener fault never rejects the run.
    expect(await result.run.wait()).toEqual({
      id: FAKE_RUN_ID,
      status: "finished",
    });
    unsubBad();
    unsubGood();

    // The faulty subscriber was invoked, but its throws were isolated: the
    // healthy subscriber still saw the same frames.
    expect(thrown).toBeGreaterThan(0);
    expect(healthy).toHaveLength(thrown);

    // Persistence is intact: all finalized events reached disk in order.
    const { transcript } = readConversation(meta.id);
    expect(transcript.map((e) => e.type)).toEqual([
      "assistant",
      "thinking",
      "tool_call",
      "task",
      "status",
      "usage",
      "request",
      "subagent_update",
      "subagent_update",
      "subagent_update",
      "subagent_update",
      "subagent_update",
      "tool_call",
    ]);
  });

  it("reports CursorAgentError as never_started, distinct from an errored wait result", async () => {
    const { createConversation, createAgentSessions } = await load();

    const neverStarted = createFakeAgentSdk({
      sendError: new CursorAgentError("Invalid API key"),
    });
    const sessionsA = createAgentSessions(neverStarted);
    const metaA = await createConversation({
      title: "Never started",
      projectId: "platform",
      model: "auto",
    });
    const failed = await sessionsA.sendPrompt(metaA.id, { prompt: "x" });
    expect(failed).toEqual({
      ok: false,
      cause: "never_started",
      error: expect.any(CursorAgentError),
    });
    if (failed.ok) return;
    expect(failed.error.message).toBe("Invalid API key");
    expect(sessionsA.getActiveRun(metaA.id)).toBeUndefined();

    const errored = createFakeAgentSdk({
      waitResult: {
        id: "run-err",
        status: "error",
        error: { message: "model failed", code: "MODEL" },
      },
    });
    const sessionsB = createAgentSessions(errored);
    const metaB = await createConversation({
      title: "Started then errored",
      projectId: "platform",
      model: "auto",
    });
    const started = await sessionsB.sendPrompt(metaB.id, { prompt: "y" });
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    expect(started.run.id).toBe("run-err");
    expect(await started.run.wait()).toEqual({
      id: "run-err",
      status: "error",
      error: { message: "model failed", code: "MODEL" },
    });
  });

  it("cancel stops the active run and disposeAll disposes live agents", async () => {
    const { createConversation, createAgentSessions } = await load();
    let release!: () => void;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fake = createFakeAgentSdk({ hold });
    const sessions = createAgentSessions(fake);

    const meta = await createConversation({
      title: "Cancel",
      projectId: "platform",
      model: "auto",
    });
    const result = await sessions.sendPrompt(meta.id, { prompt: "go" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Give the background pump a turn so it is blocked on `hold`.
    await Promise.resolve();
    expect(sessions.getActiveRun(meta.id)?.id).toBe(FAKE_RUN_ID);

    expect(await sessions.cancel(meta.id)).toBe(true);
    expect(fake.handles[0]?.cancelled).toBe(true);

    // Cancel aborts the held iterator; pump must still report cancelled via
    // agentRun.wait(), not a synthesized error status.
    expect(await result.run.wait()).toEqual({
      id: FAKE_RUN_ID,
      status: "cancelled",
    });
    release(); // hold resolvers are otherwise unused after abort
    expect(await sessions.cancel(meta.id)).toBe(false);

    await sessions.disposeAll();
    expect(fake.handles[0]?.disposed).toBe(true);
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
      nested.map((p) =>
        expect(p).rejects.toThrow(/delegate: nested run .* was cancelled/),
      ),
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

  it("dispose awaits the background pump before returning", async () => {
    const { createConversation, createAgentSessions } = await load();
    let release!: () => void;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fake = createFakeAgentSdk({ hold });
    const sessions = createAgentSessions(fake);

    const meta = await createConversation({
      title: "Dispose during run",
      projectId: "platform",
      model: "auto",
    });
    const result = await sessions.sendPrompt(meta.id, { prompt: "go" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    await Promise.resolve();
    expect(sessions.getActiveRun(meta.id)?.id).toBe(FAKE_RUN_ID);

    let disposed = false;
    const disposePromise = sessions.dispose(meta.id).then(() => {
      disposed = true;
    });

    await Promise.resolve();
    expect(disposed).toBe(false);

    release();
    await disposePromise;
    expect(disposed).toBe(true);
    expect(fake.handles[0]?.disposed).toBe(true);
  });

  it("dispose tears down a single live agent session", async () => {
    const { createConversation, createAgentSessions } = await load();
    const fake = createFakeAgentSdk();
    const sessions = createAgentSessions(fake);

    const meta = await createConversation({
      title: "Dispose one",
      projectId: "platform",
      model: "auto",
    });
    const result = await sessions.sendPrompt(meta.id, { prompt: "go" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    await result.run.wait();

    await sessions.dispose(meta.id);
    expect(fake.handles[0]?.disposed).toBe(true);
    expect(sessions.getActiveRun(meta.id)).toBeUndefined();
  });
});
