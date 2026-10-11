import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { loadConfig, loadService, useConversationFixtures } from "./conversations.test-fixtures.js";

useConversationFixtures();

describe("conversations store", () => {
  it("creates, appends, reads in order, updates meta, and deletes", async () => {
    const { conversationsDir } = await loadConfig();
    const {
      createConversation,
      appendEvent,
      readConversation,
      updateMeta,
      listConversations,
      deleteConversation,
    } = await loadService();

    const created = await createConversation({
      title: "Explore auth",
      projectId: "platform",
      model: "composer-2.5",
    });
    expect(created.id).toBe("explore-auth");
    expect(created.projectId).toBe("platform");
    expect(created.model).toBe("composer-2.5");
    expect(created.agentId).toBeUndefined();
    expect(Number.isNaN(Date.parse(created.createdAt))).toBe(false);

    const prompt = await appendEvent(created.id, {
      type: "prompt",
      text: "How does login work?",
    });
    const assistant = await appendEvent(created.id, {
      type: "assistant",
      text: "Looking at the auth routes.",
    });
    const thinking = await appendEvent(created.id, {
      type: "thinking",
      text: "Check middleware next.",
    });
    const toolCall = await appendEvent(created.id, {
      type: "tool_call",
      callId: "call-1",
      name: "read",
      status: "completed",
      args: { path: "auth.ts" },
      result: { content: "export function login() {}" },
    });
    const subagent = await appendEvent(created.id, {
      type: "subagent_update",
      parentCallId: "call-task-1",
      step: { kind: "text", text: "Nested note." },
    });
    const withHints = await appendEvent(created.id, {
      type: "tool_call",
      callId: "call-task-1",
      name: "Task",
      status: "completed",
      resultAgentId: "bc-nested-1",
      transcriptPath: "/tmp/agent-transcripts/bc-nested-1",
    });

    for (const event of [
      prompt,
      assistant,
      thinking,
      toolCall,
      subagent,
      withHints,
    ]) {
      expect(Number.isNaN(Date.parse(event.at))).toBe(false);
    }

    const detail = readConversation(created.id);
    expect(detail.transcript.map((e) => e.type)).toEqual([
      "prompt",
      "assistant",
      "thinking",
      "tool_call",
      "subagent_update",
      "tool_call",
    ]);
    expect(detail.transcript[0]).toMatchObject({
      type: "prompt",
      text: "How does login work?",
    });
    expect(detail.transcript[3]).toMatchObject({
      type: "tool_call",
      callId: "call-1",
      status: "completed",
    });
    expect(detail.transcript[4]).toMatchObject({
      type: "subagent_update",
      parentCallId: "call-task-1",
      step: { kind: "text", text: "Nested note." },
    });
    expect(detail.transcript[5]).toMatchObject({
      type: "tool_call",
      resultAgentId: "bc-nested-1",
      transcriptPath: "/tmp/agent-transcripts/bc-nested-1",
    });

    const raw = readFileSync(
      join(conversationsDir, created.id, "transcript.jsonl"),
      "utf8",
    );
    expect(raw.endsWith("\n")).toBe(true);
    expect(raw.trim().split("\n")).toHaveLength(6);

    const updated = await updateMeta(created.id, {
      title: "Auth deep dive",
      agentId: "agent-123",
      model: "auto",
    });
    expect(updated.title).toBe("Auth deep dive");
    expect(updated.agentId).toBe("agent-123");
    expect(updated.model).toBe("auto");
    expect(updated.updatedAt >= created.updatedAt).toBe(true);

    const listed = listConversations();
    expect(listed).toHaveLength(1);
    expect(listed[0]?.id).toBe(created.id);
    expect(listed[0]?.title).toBe("Auth deep dive");

    await deleteConversation(created.id);
    expect(existsSync(join(conversationsDir, created.id))).toBe(false);
    expect(listConversations()).toEqual([]);
  });

  it("createIssueChannelSession archives predecessors atomically under concurrent create", async () => {
    const { createIssueChannelSession, listConversations } = await loadService();
    const idle = { getActiveRun: () => undefined };

    const [a, b] = await Promise.all([
      createIssueChannelSession(
        {
          issueId: "capture",
          channel: "planning",
          projectId: "platform",
          title: "Concurrent A",
          model: "composer-2.5",
        },
        idle,
      ),
      createIssueChannelSession(
        {
          issueId: "capture",
          channel: "planning",
          projectId: "platform",
          title: "Concurrent B",
          model: "composer-2.5",
        },
        idle,
      ),
    ]);

    expect(a.meta.id).not.toBe(b.meta.id);
    const active = listConversations().filter(
      (m) =>
        m.issueId === "capture" &&
        m.channel === "planning" &&
        !m.archived,
    );
    expect(active).toHaveLength(1);
    expect([a.meta.id, b.meta.id]).toContain(active[0]!.id);
  });
});
