import { dirname, join } from "path";
import { describe, expect, it } from "vitest";
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
  issuesRoot,
  load,
  useAgentSessionsTestFixtures,
  workspaceDir,
} from "./agent-sessions.test-harness.js";

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

});
