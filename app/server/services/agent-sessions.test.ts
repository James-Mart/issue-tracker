import { mkdirSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { describe, expect, it, vi } from "vitest";
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
import {
  AT,
  issuesRoot,
  load,
  useAgentSessionsTestFixtures,
  workspaceDir,
  writeIssue,
} from "./agent-sessions.test-harness.js";
import type { ConversationFrame } from "./conversation-stream.js";

useAgentSessionsTestFixtures();

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
    expect(fake.created[0]?.customTools?.agent_stack_start).toBeDefined();
    expect(fake.created[0]?.customTools?.agent_stack_stop).toBeDefined();
    expect(fake.created[0]?.agents).toBeUndefined();
    expect(fake.resumed).toHaveLength(0);
    expect(fake.handles[0]?.sends).toEqual([
      { message: "go", options: {} },
    ]);

    expect(readConversation(meta.id).meta.agentId).toBe(FAKE_AGENT_ID);

    // Cursor conversation_id for hooks is the runtime agentId; the tool must
    // see it after create without taking it as an argument.
    const { agentStackDir, agentStackStatePath, agentStackCursorIndexPath } =
      await import("./agent-stack.js");
    const { spawn } = await import("node:child_process");
    const { writeFileSync, mkdirSync, readFileSync, existsSync } =
      await import("node:fs");
    const child = spawn("sh", ["-c", "sleep 300"], {
      detached: true,
      stdio: "ignore",
    });
    const pid = child.pid!;
    child.unref();
    const procStat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const startTok = procStat
      .slice(procStat.lastIndexOf(")") + 2)
      .split(" ")[19]!;
    mkdirSync(agentStackDir(meta.id), { recursive: true });
    writeFileSync(
      agentStackStatePath(meta.id),
      JSON.stringify({
        conversationId: meta.id,
        apiPort: 43001,
        vitePort: 43002,
        baseUrl: "http://127.0.0.1:43002",
        startedAt: "2026-01-01T00:00:00.000Z",
        processes: [{ role: "api", pid, startTime: startTok }],
      }),
    );
    try {
      const started = (await fake.created[0]!.customTools!.agent_stack_start!.execute(
        {},
        {},
      )) as { reused: boolean };
      expect(started.reused).toBe(true);
      expect(
        JSON.parse(
          readFileSync(agentStackCursorIndexPath(FAKE_AGENT_ID), "utf8"),
        ),
      ).toEqual({ appConversationId: meta.id });
      await fake.created[0]!.customTools!.agent_stack_stop!.execute({}, {});
      expect(existsSync(agentStackStatePath(meta.id))).toBe(false);
      expect(existsSync(agentStackCursorIndexPath(FAKE_AGENT_ID))).toBe(false);
    } finally {
      try {
        process.kill(-pid, "SIGKILL");
      } catch {
        // Already gone.
      }
    }
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
          customTools: expect.objectContaining({
            delegate: expect.any(Object),
          }),
        },
      },
    ]);
    expect(fake.handles[0]?.sends).toEqual([
      { message: "again", options: { model: { id: "composer-2.5" } } },
    ]);
  });

  it("passes a plain string to the handle when send has no images", async () => {
    const { createConversation, createAgentSessions } = await load();
    const fake = createFakeAgentSdk();
    const sessions = createAgentSessions(fake);

    const meta = await createConversation({
      title: "Text only",
      projectId: "platform",
      model: "composer-2.5",
    });

    const result = await sessions.sendPrompt(meta.id, { prompt: "hello" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    await result.run.wait();

    expect(fake.handles[0]?.sends).toEqual([{ message: "hello", options: {} }]);
  });

  it("passes a message object with images to the handle when send includes images", async () => {
    const { createConversation, createAgentSessions } = await load();
    const fake = createFakeAgentSdk();
    const sessions = createAgentSessions(fake);

    const meta = await createConversation({
      title: "With image",
      projectId: "platform",
      model: "composer-2.5",
    });
    const images = [{ data: "aGVsbG8=", mimeType: "image/png" }];

    const result = await sessions.sendPrompt(meta.id, {
      prompt: "what is this?",
      images,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    await result.run.wait();

    expect(fake.handles[0]?.sends).toEqual([
      {
        message: { text: "what is this?", images },
        options: {},
      },
    ]);
  });

  it("routes a stored compound grok pin through the model bridge on resume", async () => {
    const { createConversation, createAgentSessions } = await load();
    const fake = createFakeAgentSdk();
    const sessions = createAgentSessions(fake);

    const meta = await createConversation({
      title: "Legacy grok pin",
      projectId: "platform",
      model: "cursor-grok-4.5-high-fast",
      agentId: "agent-grok-legacy",
    });

    const result = await sessions.sendPrompt(meta.id, { prompt: "again" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    await result.run.wait();

    expect(fake.created).toHaveLength(0);
    expect(fake.resumed).toEqual([
      {
        agentId: "agent-grok-legacy",
        storeDir: join(
          dirname(issuesRoot),
          "conversations",
          meta.id,
          "agent-state",
        ),
        options: {
          cwd: workspaceDir,
          model: {
            id: "grok-4.5",
            params: [
              { id: "effort", value: "high" },
              { id: "fast", value: "true" },
            ],
          },
          customTools: expect.objectContaining({
            delegate: expect.any(Object),
          }),
        },
      },
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
    expect(fake.handles[0]?.sends).toEqual([{ message: "continue", options: {} }]);

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

    expect(transcript[0]).toMatchObject({
      type: "assistant",
      text: "On it.",
    });
    expect(transcript[2]).toMatchObject({
      type: "tool_call",
      callId: PRIMARY_TOOL_CALL_ID,
      name: "read",
      status: "running",
    });
    expect(transcript[3]).toMatchObject({
      type: "tool_call",
      callId: PRIMARY_TOOL_CALL_ID,
      name: "read",
      status: "completed",
    });
    expect(
      transcript.filter(
        (e) => e.type === "tool_call" && e.callId === TASK_TOOL_CALL_ID,
      ),
    ).toEqual([
      expect.objectContaining({ status: "running" }),
      expect.objectContaining({ status: "completed" }),
    ]);

    const nested = transcript.filter((e) => e.type === "subagent_update");
    expect(nested.every((e) => e.parentCallId === TASK_TOOL_CALL_ID)).toBe(true);
    expect(nested.map((e) => e.step.kind)).toEqual([
      "text",
      "thinking",
      "tool_call",
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
        status: "running",
      },
    });
    expect(nested[3]).toMatchObject({
      step: {
        kind: "tool_call",
        callId: "nested-shell-1",
        name: "shell",
        status: "completed",
      },
    });

    const taskDone = transcript.find(
      (e) =>
        e.type === "tool_call" &&
        e.callId === TASK_TOOL_CALL_ID &&
        e.status === "completed",
    );
    expect(taskDone).toMatchObject({
      type: "tool_call",
      status: "completed",
      resultAgentId: NESTED_AGENT_ID,
    });
  });

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
      .map((f) => ({ kind: f.event.step.kind, status: f.event.step.status }));
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
      transcript.filter(
        (e) => e.type === "tool_call" && e.callId === PRIMARY_TOOL_CALL_ID,
      ).map((e) => e.status),
    ).toEqual(["running", "completed"]);
    expect(
      transcript.filter(
        (e) => e.type === "tool_call" && e.callId === TASK_TOOL_CALL_ID,
      ).map((e) => e.status),
    ).toEqual(["running", "completed"]);
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

    // Persistence is intact: all durable transcript events reached disk in order.
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

  it("publishes exactly one started and one finished run frame for a scripted run", async () => {
    const {
      createConversation,
      readConversation,
      createAgentSessions,
      subscribeFrames,
    } = await load();
    const fake = createFakeAgentSdk({
      stream: buildScriptedStreamWithAgentIdHint(),
    });
    const sessions = createAgentSessions(fake);

    const meta = await createConversation({
      title: "Run lifecycle",
      projectId: "platform",
      model: "auto",
    });

    const frames: ConversationFrame[] = [];
    const unsubscribe = subscribeFrames(meta.id, (frame) => {
      frames.push(frame);
    });

    const result = await sessions.sendPrompt(meta.id, { prompt: "go" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    await result.run.wait();
    unsubscribe();

    expect(frames[0]).toMatchObject({
      event: { type: "run", status: "started", runId: FAKE_RUN_ID, seq: 1 },
      persist: false,
    });

    const runFrames = frames.filter(
      (f): f is ConversationFrame & { event: { type: "run" } } =>
        f.event.type === "run",
    );
    expect(runFrames).toHaveLength(2);
    expect(runFrames[0]).toMatchObject({
      event: { type: "run", status: "started", runId: FAKE_RUN_ID, seq: 1 },
      persist: false,
    });
    expect(runFrames[1]).toMatchObject({
      event: { type: "run", status: "finished", runId: FAKE_RUN_ID },
      persist: false,
    });
    expect(runFrames[1]!.event.seq).toBeGreaterThan(1);

    const { transcript } = readConversation(meta.id);
    expect(transcript.some((e) => e.type === "run")).toBe(false);
  });

  it("publishes planning-run frames on the issues topic when an issue-anchored run starts and finishes", async () => {
    writeIssue("capture", {
      kind: "idea",
      title: "Capture",
      partOf: "platform",
      createdAt: AT,
      updatedAt: AT,
    });

    const { createConversation, createAgentSessions, subscribeFrames } =
      await load();
    const fake = createFakeAgentSdk({
      stream: buildScriptedStreamWithAgentIdHint(),
    });
    const sessions = createAgentSessions(fake);

    const meta = await createConversation({
      title: "Plan capture",
      projectId: "platform",
      model: "auto",
      issueId: "capture",
      channel: "planning",
    });

    const issueFrames: ConversationFrame[] = [];
    const unsubscribe = subscribeFrames("issues", (frame) => {
      issueFrames.push(frame);
    });

    const result = await sessions.sendPrompt(meta.id, { prompt: "go" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    await result.run.wait();
    unsubscribe();

    expect(issueFrames).toHaveLength(2);
    expect(issueFrames[0]).toMatchObject({
      event: { type: "change", id: "capture", scope: "planning-run" },
      persist: false,
    });
    expect(issueFrames[1]).toMatchObject({
      event: { type: "change", id: "capture", scope: "planning-run" },
      persist: false,
    });
  });

  it("publishes pipeline-run frames on pipeline:runs when a run starts and finishes", async () => {
    const { createConversation, createAgentSessions, subscribeFrames } =
      await load();
    const fake = createFakeAgentSdk({
      stream: buildScriptedStreamWithAgentIdHint(),
    });
    const sessions = createAgentSessions(fake);

    const meta = await createConversation({
      title: "Pipeline runs live",
      projectId: "platform",
      model: "auto",
    });

    const pipelineFrames: ConversationFrame[] = [];
    const unsubscribe = subscribeFrames("pipeline:runs", (frame) => {
      pipelineFrames.push(frame);
    });

    const result = await sessions.sendPrompt(meta.id, { prompt: "go" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    await result.run.wait();
    unsubscribe();

    expect(pipelineFrames).toHaveLength(2);
    expect(pipelineFrames[0]).toMatchObject({
      event: {
        type: "pipeline-run",
        status: "started",
        conversationId: meta.id,
      },
      persist: false,
    });
    expect(pipelineFrames[1]).toMatchObject({
      event: {
        type: "pipeline-run",
        status: "finished",
        conversationId: meta.id,
      },
      persist: false,
    });
  });

  it("publishes finished when a run is cancelled mid-flight", async () => {
    const { createConversation, createAgentSessions, subscribeFrames } =
      await load();
    let release!: () => void;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fake = createFakeAgentSdk({ hold });
    const sessions = createAgentSessions(fake);

    const meta = await createConversation({
      title: "Run cancel lifecycle",
      projectId: "platform",
      model: "auto",
    });

    const frames: ConversationFrame[] = [];
    const unsubscribe = subscribeFrames(meta.id, (frame) => {
      frames.push(frame);
    });

    const result = await sessions.sendPrompt(meta.id, { prompt: "go" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    await Promise.resolve();
    expect(await sessions.cancel(meta.id)).toBe(true);
    await result.run.wait();
    release();
    unsubscribe();

    const runFrames = frames.filter(
      (f): f is ConversationFrame & { event: { type: "run" } } =>
        f.event.type === "run",
    );
    expect(runFrames).toHaveLength(2);
    expect(runFrames[0]).toMatchObject({
      event: { type: "run", status: "started", runId: FAKE_RUN_ID, seq: 1 },
      persist: false,
    });
    expect(runFrames[1]).toMatchObject({
      event: { type: "run", status: "finished", runId: FAKE_RUN_ID, seq: 2 },
      persist: false,
    });
  });

  it("dispose and disposeAll evict agent-state and nested store caches", async () => {
    const { createConversation, createAgentSessions } = await load();
    const cachedMod = await import("./agent-state-caches.js");
    const evictSpy = vi.spyOn(cachedMod, "evictConversationStoreCaches");

    const fake = createFakeAgentSdk();
    const sessions = createAgentSessions(fake);

    const meta = await createConversation({
      title: "Evict on dispose",
      projectId: "platform",
      model: "auto",
    });
    const storeDir = join(
      dirname(issuesRoot),
      "conversations",
      meta.id,
      "agent-state",
    );
    mkdirSync(join(storeDir, "nested", "nested-one"), { recursive: true });
    mkdirSync(join(storeDir, "nested", "nested-two"), { recursive: true });

    const result = await sessions.sendPrompt(meta.id, { prompt: "go" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    await result.run.wait();

    evictSpy.mockClear();
    await sessions.dispose(meta.id);
    expect(evictSpy).toHaveBeenCalledTimes(1);
    expect(evictSpy).toHaveBeenCalledWith(storeDir);

    // Rebuild a session and verify disposeAll also evicts.
    const result2 = await sessions.sendPrompt(meta.id, { prompt: "again" });
    expect(result2.ok).toBe(true);
    if (!result2.ok) return;
    await result2.run.wait();

    evictSpy.mockClear();
    await sessions.disposeAll();
    expect(evictSpy).toHaveBeenCalledTimes(1);
    expect(evictSpy).toHaveBeenCalledWith(storeDir);
    evictSpy.mockRestore();
  });

  it("dispose and disposeAll always clear the catch-up buffer", async () => {
    const { createConversation, createAgentSessions } = await load();
    const { publishFrame, getFramesSince } = await import(
      "./conversation-stream.js"
    );
    const fake = createFakeAgentSdk();
    const sessions = createAgentSessions(fake);

    const meta = await createConversation({
      title: "Catch-up teardown",
      projectId: "platform",
      model: "auto",
    });
    publishFrame(meta.id, {
      event: { type: "assistant", text: "buffered" },
      persist: false,
    });
    const buffered = getFramesSince(meta.id, 0);
    expect(buffered.resetRequired).toBe(false);
    if (buffered.resetRequired) return;
    expect(buffered.frames).toHaveLength(1);

    await sessions.dispose(meta.id);
    expect(getFramesSince(meta.id, 0)).toEqual({
      resetRequired: false,
      frames: [],
    });

    publishFrame(meta.id, {
      event: { type: "assistant", text: "buffered again" },
      persist: false,
    });
    const result = await sessions.sendPrompt(meta.id, { prompt: "go" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    await result.run.wait();

    publishFrame(meta.id, {
      event: { type: "run", status: "started", runId: "run-2" },
      persist: false,
    });
    // Buffer was cleared on dispose, so the window no longer reaches seq 0;
    // ask from the pre-dispose high-water mark.
    const afterRun = getFramesSince(meta.id, 1);
    expect(afterRun.resetRequired).toBe(false);
    if (afterRun.resetRequired) return;
    expect(afterRun.frames.length).toBeGreaterThan(0);

    await sessions.disposeAll();
    expect(getFramesSince(meta.id, 1)).toEqual({
      resetRequired: false,
      frames: [],
    });
  });

  it("dispose stops a live agent stack and clears durable ownership", async () => {
    const { createConversation, createAgentSessions } = await load();
    const { spawn } = await import("node:child_process");
    const { existsSync, mkdirSync, readFileSync, writeFileSync } =
      await import("node:fs");
    const {
      agentStackCursorIndexDir,
      agentStackDir,
      agentStackCursorIndexPath,
      agentStackStatePath,
    } = await import("./agent-stack.js");

    const fake = createFakeAgentSdk();
    const sessions = createAgentSessions(fake);

    const meta = await createConversation({
      title: "Stack teardown",
      projectId: "platform",
      model: "auto",
    });
    const result = await sessions.sendPrompt(meta.id, { prompt: "go" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    await result.run.wait();

    const child = spawn("sh", ["-c", "sleep 300 & wait"], {
      detached: true,
      stdio: "ignore",
    });
    const pid = child.pid!;
    child.unref();
    const procStat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const startTok = procStat
      .slice(procStat.lastIndexOf(")") + 2)
      .split(" ")[19]!;
    mkdirSync(agentStackDir(meta.id), { recursive: true });
    writeFileSync(
      agentStackStatePath(meta.id),
      JSON.stringify({
        conversationId: meta.id,
        apiPort: 44001,
        vitePort: 44002,
        baseUrl: "http://127.0.0.1:44002",
        startedAt: "2026-01-01T00:00:00.000Z",
        processes: [{ role: "api", pid, startTime: startTok }],
        cursorConversationIds: [FAKE_AGENT_ID],
      }),
    );
    mkdirSync(agentStackCursorIndexDir(), { recursive: true });
    writeFileSync(
      agentStackCursorIndexPath(FAKE_AGENT_ID),
      `${JSON.stringify({ appConversationId: meta.id }, null, 2)}\n`,
    );

    await sessions.dispose(meta.id);

    expect(existsSync(`/proc/${pid}`)).toBe(false);
    expect(existsSync(agentStackStatePath(meta.id))).toBe(false);
    expect(existsSync(agentStackCursorIndexPath(FAKE_AGENT_ID))).toBe(false);
    expect(fake.handles[0]?.disposed).toBe(true);
  });

  it("dispose succeeds when the agent stack was already stopped", async () => {
    const { createConversation, createAgentSessions } = await load();
    const { existsSync, mkdirSync, writeFileSync } = await import("node:fs");
    const { agentStackDir, agentStackStatePath, stopAgentStack } =
      await import("./agent-stack.js");

    const fake = createFakeAgentSdk();
    const sessions = createAgentSessions(fake);

    const meta = await createConversation({
      title: "Stack already stopped",
      projectId: "platform",
      model: "auto",
    });
    const result = await sessions.sendPrompt(meta.id, { prompt: "go" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    await result.run.wait();

    mkdirSync(agentStackDir(meta.id), { recursive: true });
    writeFileSync(
      agentStackStatePath(meta.id),
      JSON.stringify({
        conversationId: meta.id,
        apiPort: 44001,
        vitePort: 44002,
        baseUrl: "http://127.0.0.1:44002",
        startedAt: "2026-01-01T00:00:00.000Z",
        processes: [],
      }),
    );
    await stopAgentStack(meta.id);
    expect(existsSync(agentStackStatePath(meta.id))).toBe(false);

    await expect(sessions.dispose(meta.id)).resolves.toBeUndefined();
    expect(fake.handles[0]?.disposed).toBe(true);
  });

  it("disposeAll stops agent stacks for every disposed conversation", async () => {
    const { createConversation, createAgentSessions } = await load();
    const { spawn } = await import("node:child_process");
    const { existsSync, mkdirSync, readFileSync, writeFileSync } =
      await import("node:fs");
    const { agentStackDir, agentStackStatePath } = await import(
      "./agent-stack.js"
    );

    const fake = createFakeAgentSdk();
    const sessions = createAgentSessions(fake);

    const metaA = await createConversation({
      title: "Stack A",
      projectId: "platform",
      model: "auto",
    });
    const metaB = await createConversation({
      title: "Stack B",
      projectId: "platform",
      model: "auto",
    });
    for (const meta of [metaA, metaB]) {
      const result = await sessions.sendPrompt(meta.id, { prompt: "go" });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      await result.run.wait();
    }

    function recordStack(conversationId: string, portBase: number): number {
      const child = spawn("sh", ["-c", "sleep 300 & wait"], {
        detached: true,
        stdio: "ignore",
      });
      const pid = child.pid!;
      child.unref();
      const procStat = readFileSync(`/proc/${pid}/stat`, "utf8");
      const startTok = procStat
        .slice(procStat.lastIndexOf(")") + 2)
        .split(" ")[19]!;
      mkdirSync(agentStackDir(conversationId), { recursive: true });
      writeFileSync(
        agentStackStatePath(conversationId),
        JSON.stringify({
          conversationId,
          apiPort: portBase,
          vitePort: portBase + 1,
          baseUrl: `http://127.0.0.1:${portBase + 1}`,
          startedAt: "2026-01-01T00:00:00.000Z",
          processes: [{ role: "api", pid, startTime: startTok }],
        }),
      );
      return pid;
    }

    const pidA = recordStack(metaA.id, 45001);
    const pidB = recordStack(metaB.id, 45003);

    await sessions.disposeAll();

    expect(existsSync(`/proc/${pidA}`)).toBe(false);
    expect(existsSync(`/proc/${pidB}`)).toBe(false);
    expect(existsSync(agentStackStatePath(metaA.id))).toBe(false);
    expect(existsSync(agentStackStatePath(metaB.id))).toBe(false);
  });
});
