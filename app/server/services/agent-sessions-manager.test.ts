import { dirname, join } from "path";
import { describe, expect, it } from "vitest";
import {
  buildScriptedStreamWithAgentIdHint,
  createFakeAgentSdk,
  FAKE_AGENT_ID,
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
          conversationId: meta.id,
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
