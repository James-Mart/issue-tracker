import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const AT = "2026-07-09T14:00:00.000Z";
let root: string;
let issuesDir: string;

function writeIssue(id: string, body: Record<string, unknown>): void {
  mkdirSync(join(issuesDir, id), { recursive: true });
  writeFileSync(
    join(issuesDir, id, "issue.json"),
    JSON.stringify({ id, ...body }),
  );
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "issue-tracker-conversations-"));
  issuesDir = join(root, "issues");
  mkdirSync(issuesDir, { recursive: true });
  vi.resetModules();
  vi.stubEnv("ISSUES_DIR", issuesDir);
  writeIssue("platform", {
    kind: "project",
    title: "Platform",
    createdAt: AT,
    updatedAt: AT,
  });
  writeIssue("capture", {
    kind: "idea",
    title: "Capture",
    partOf: "platform",
    createdAt: AT,
    updatedAt: AT,
  });
  writeIssue("add-auth", {
    kind: "epic",
    title: "Add auth",
    partOf: "platform",
    createdAt: AT,
    updatedAt: AT,
  });
  writeIssue("root-story", {
    kind: "story",
    title: "Root story",
    partOf: "platform",
    createdAt: AT,
    updatedAt: AT,
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

async function loadService() {
  return import("./conversations.js");
}

async function loadConfig() {
  return import("../config.js");
}

describe("conversations store", () => {
  it("stores conversations as a peer of issues/, never under the issues service", async () => {
    const { conversationsDir } = await loadConfig();
    const { createConversation } = await loadService();

    expect(conversationsDir).toBe(join(root, "conversations"));
    expect(dirname(conversationsDir)).toBe(dirname(issuesDir));
    expect(conversationsDir).not.toBe(issuesDir);

    const issueIdsBefore = readdirSync(issuesDir).sort();

    const meta = await createConversation({
      title: "Hello World",
      projectId: "platform",
      model: "composer-2.5",
    });

    expect(existsSync(join(conversationsDir, meta.id, "meta.json"))).toBe(true);
    expect(existsSync(join(conversationsDir, meta.id, "transcript.jsonl"))).toBe(
      true,
    );
    expect(
      existsSync(join(conversationsDir, meta.id, "delegations.jsonl")),
    ).toBe(true);
    // Peer of issues/ — not nested inside the issues store.
    expect(existsSync(join(issuesDir, meta.id))).toBe(false);
    expect(readdirSync(issuesDir).sort()).toEqual(issueIdsBefore);
  });

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

  it("mints collision suffixes for duplicate titles", async () => {
    const { createConversation } = await loadService();
    const a = await createConversation({
      title: "Notes",
      projectId: "p",
      model: "auto",
    });
    const b = await createConversation({
      title: "Notes",
      projectId: "p",
      model: "auto",
    });
    expect(a.id).toBe("notes");
    expect(b.id).toBe("notes-2");
  });

  it("skips malformed transcript lines on read", async () => {
    const { conversationsDir } = await loadConfig();
    const { createConversation, appendEvent, readConversation } =
      await loadService();

    const meta = await createConversation({
      title: "Skip bad",
      projectId: "p",
      model: "auto",
    });
    await appendEvent(meta.id, { type: "prompt", text: "first" });
    const path = join(conversationsDir, meta.id, "transcript.jsonl");
    writeFileSync(
      path,
      [
        JSON.stringify({ type: "prompt", text: "first", at: "2026-07-24T00:00:00.000Z" }),
        "not-json",
        JSON.stringify({ type: "assistant", text: "ok", at: "2026-07-24T00:00:01.000Z" }),
        JSON.stringify({ type: "unknown", at: "2026-07-24T00:00:02.000Z" }),
        "",
      ].join("\n") + "\n",
    );

    const detail = readConversation(meta.id);
    expect(detail.transcript.map((e) => e.type)).toEqual(["prompt", "assistant"]);
  });

  it("throws for unknown conversation ids", async () => {
    const {
      readConversation,
      appendEvent,
      appendDelegation,
      readDelegations,
      updateMeta,
      deleteConversation,
    } = await loadService();

    expect(() => readConversation("ghost")).toThrow(/unknown conversation/);
    expect(() => readDelegations("ghost")).toThrow(/unknown conversation/);
    await expect(
      appendEvent("ghost", { type: "prompt", text: "x" }),
    ).rejects.toThrow(/unknown conversation/);
    await expect(
      appendDelegation("ghost", {
        delegationId: "d1",
        agentId: "a1",
        role: "r",
        model: "m",
      }),
    ).rejects.toThrow(/unknown conversation/);
    await expect(updateMeta("ghost", { title: "x" })).rejects.toThrow(
      /unknown conversation/,
    );
    await expect(deleteConversation("ghost")).rejects.toThrow(
      /unknown conversation/,
    );
  });

  it("parses meta without archived and defaults archived to false", async () => {
    const { conversationsDir } = await loadConfig();
    const { parseConversationMeta } = await import("../schemas.js");

    mkdirSync(join(conversationsDir, "legacy-chat"), { recursive: true });
    writeFileSync(
      join(conversationsDir, "legacy-chat", "meta.json"),
      JSON.stringify({
        id: "legacy-chat",
        title: "Legacy",
        projectId: "platform",
        model: "auto",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      }),
    );

    const raw = JSON.parse(
      readFileSync(join(conversationsDir, "legacy-chat", "meta.json"), "utf8"),
    );
    const parsed = parseConversationMeta(raw);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.meta.archived).toBe(false);
  });

  it("updates archived via updateMeta", async () => {
    const { createConversation, updateMeta, readConversation } =
      await loadService();

    const created = await createConversation({
      title: "Archive me",
      projectId: "platform",
      model: "auto",
    });
    expect(readConversation(created.id).meta.archived).toBe(false);

    const archived = await updateMeta(created.id, { archived: true });
    expect(archived.archived).toBe(true);
    expect(readConversation(created.id).meta.archived).toBe(true);
  });

  it("creates an anchored conversation and round-trips through readConversation", async () => {
    const { conversationsDir } = await loadConfig();
    const { createConversation, readConversation } = await loadService();

    const created = await createConversation({
      title: "Plan capture",
      projectId: "platform",
      model: "composer-2.5",
      issueId: "capture",
      channel: "planning",
    });
    expect(created.issueId).toBe("capture");
    expect(created.channel).toBe("planning");

    const detail = readConversation(created.id);
    expect(detail.meta.issueId).toBe("capture");
    expect(detail.meta.channel).toBe("planning");

    const raw = JSON.parse(
      readFileSync(join(conversationsDir, created.id, "meta.json"), "utf8"),
    );
    expect(raw.issueId).toBe("capture");
    expect(raw.channel).toBe("planning");
  });

  it("refuses half an anchor on create", async () => {
    const { createConversation } = await loadService();

    await expect(
      createConversation({
        title: "Half anchor",
        projectId: "platform",
        model: "auto",
        issueId: "capture",
      }),
    ).rejects.toThrow(/channel is required when issueId is set/);

    await expect(
      createConversation({
        title: "Half anchor",
        projectId: "platform",
        model: "auto",
        channel: "planning",
      }),
    ).rejects.toThrow(/issueId is required when channel is set/);
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

  it("createIssueChannelSession refuses before writing when the channel is ineligible", async () => {
    const { createIssueChannelSession, listConversations } = await loadService();
    const idle = { getActiveRun: () => undefined };

    const prior = await createIssueChannelSession(
      {
        issueId: "capture",
        channel: "planning",
        projectId: "platform",
        title: "Keep me",
        model: "composer-2.5",
      },
      idle,
    );

    await expect(
      createIssueChannelSession(
        {
          issueId: "capture",
          channel: "implementing",
          projectId: "platform",
          title: "Should not land",
          model: "composer-2.5",
        },
        idle,
      ),
    ).rejects.toThrow(/channel "implementing" is not offered by issue "capture"/);

    const listed = listConversations().filter(
      (m) => m.issueId === "capture" && m.channel === "planning",
    );
    expect(listed).toEqual([
      expect.objectContaining({ id: prior.meta.id, archived: false }),
    ]);
    expect(
      listConversations().some(
        (m) => m.issueId === "capture" && m.channel === "implementing",
      ),
    ).toBe(false);
  });

  it("refuses an unknown issueId on anchored create", async () => {
    const { createConversation } = await loadService();

    await expect(
      createConversation({
        title: "Ghost anchor",
        projectId: "platform",
        model: "auto",
        issueId: "ghost",
        channel: "planning",
      }),
    ).rejects.toThrow(/unknown issue "ghost"/);
  });

  it("appends and reads delegation records, omitting parent when root-delegated", async () => {
    const { conversationsDir } = await loadConfig();
    const { createConversation, appendDelegation, readDelegations } =
      await loadService();

    const meta = await createConversation({
      title: "Delegations",
      projectId: "platform",
      model: "composer-2.5",
    });

    const root = await appendDelegation(meta.id, {
      delegationId: "del-root",
      agentId: "agent-nested-1",
      role: "pinned-role",
      model: '{"id":"grok-4.5","effort":"high","fast":true}',
    });
    expect(root.parentDelegationId).toBeUndefined();
    expect(Number.isNaN(Date.parse(root.at))).toBe(false);

    const child = await appendDelegation(meta.id, {
      delegationId: "del-child",
      agentId: "agent-nested-2",
      role: "pinned-role",
      model: '{"id":"grok-4.5","effort":"high","fast":true}',
      parentDelegationId: "del-root",
    });
    expect(child.parentDelegationId).toBe("del-root");

    const records = readDelegations(meta.id);
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({
      delegationId: "del-root",
      agentId: "agent-nested-1",
      role: "pinned-role",
    });
    expect(records[0]).not.toHaveProperty("parentDelegationId");
    expect(records[1]).toMatchObject({
      delegationId: "del-child",
      agentId: "agent-nested-2",
      parentDelegationId: "del-root",
    });

    const raw = readFileSync(
      join(conversationsDir, meta.id, "delegations.jsonl"),
      "utf8",
    );
    expect(raw.endsWith("\n")).toBe(true);
    const lines = raw.trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!)).not.toHaveProperty("parentDelegationId");
    expect(JSON.parse(lines[1]!)).toHaveProperty(
      "parentDelegationId",
      "del-root",
    );
  });

  it("folds an end line onto its start record through readDelegations", async () => {
    const { conversationsDir } = await loadConfig();
    const {
      createConversation,
      appendDelegation,
      appendDelegationEnd,
      readDelegations,
    } = await loadService();

    const meta = await createConversation({
      title: "End fold",
      projectId: "platform",
      model: "composer-2.5",
    });

    const start = await appendDelegation(meta.id, {
      delegationId: "del-ended",
      agentId: "agent-nested-1",
      role: "pinned-role",
      model: "auto",
    });
    await appendDelegationEnd(meta.id, {
      delegationId: "del-ended",
      status: "completed",
    });

    const records = readDelegations(meta.id);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      delegationId: "del-ended",
      agentId: "agent-nested-1",
      lifecycle: "tracked",
      end: {
        status: "completed",
      },
    });
    expect(records[0]!.end!.endedAt).toEqual(expect.any(String));
    expect(Number.isNaN(Date.parse(records[0]!.end!.endedAt))).toBe(false);

    const raw = readFileSync(
      join(conversationsDir, meta.id, "delegations.jsonl"),
      "utf8",
    );
    const lines = raw.trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!)).toMatchObject({
      delegationId: "del-ended",
      lifecycle: "tracked",
      at: start.at,
    });
    expect(JSON.parse(lines[1]!)).toMatchObject({
      kind: "end",
      delegationId: "del-ended",
      status: "completed",
    });
  });

  it("leaves start records without an end line without end", async () => {
    const { createConversation, appendDelegation, readDelegations } =
      await loadService();

    const meta = await createConversation({
      title: "Open delegation",
      projectId: "platform",
      model: "composer-2.5",
    });

    await appendDelegation(meta.id, {
      delegationId: "del-open",
      agentId: "agent-nested-1",
      role: "pinned-role",
      model: "auto",
    });

    const records = readDelegations(meta.id);
    expect(records).toHaveLength(1);
    expect(records[0]).not.toHaveProperty("end");
  });

  it("reads legacy start records without lifecycle", async () => {
    const { conversationsDir } = await loadConfig();
    const { createConversation, readDelegations } = await loadService();

    const meta = await createConversation({
      title: "Legacy delegation",
      projectId: "platform",
      model: "composer-2.5",
    });

    const path = join(conversationsDir, meta.id, "delegations.jsonl");
    writeFileSync(
      path,
      `${JSON.stringify({
        delegationId: "del-legacy",
        agentId: "agent-legacy",
        role: "old-role",
        model: "auto",
        at: "2026-01-01T00:00:00.000Z",
      })}\n`,
    );

    const records = readDelegations(meta.id);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      delegationId: "del-legacy",
      agentId: "agent-legacy",
      role: "old-role",
    });
    expect(records[0]).not.toHaveProperty("lifecycle");
    expect(records[0]).not.toHaveProperty("end");
  });
});

describe("appendDelegation live frames", () => {
  it("publishes one live delegation frame when issueId is set and never persists it", async () => {
    const { conversationsDir } = await loadConfig();
    const { createConversation, appendDelegation } = await loadService();
    const { subscribeFrames } = await import("./conversation-stream.js");

    const meta = await createConversation({
      title: "Issue-linked delegation",
      projectId: "platform",
      model: "composer-2.5",
    });
    const streamed: Array<{
      persist: boolean;
      event: { type?: string; run?: Record<string, unknown>; seq?: number };
    }> = [];
    const unsubscribe = subscribeFrames(meta.id, (frame) => {
      streamed.push(frame);
    });

    const record = await appendDelegation(meta.id, {
      delegationId: "del-linked",
      agentId: "agent-nested-1",
      role: "implementor",
      model: "composer-2.5",
      issueId: "add-auth",
      parentCallId: "call-task-1",
    });
    unsubscribe();

    expect(streamed).toHaveLength(1);
    expect(streamed[0]).toMatchObject({
      persist: false,
      event: {
        type: "delegation",
        run: {
          delegationId: "del-linked",
          agentId: "agent-nested-1",
          role: "implementor",
          model: "composer-2.5",
          issueId: "add-auth",
          parentCallId: "call-task-1",
          conversationId: meta.id,
          startedAt: record.at,
          status: "running",
          isResume: false,
        },
      },
    });
    expect(typeof streamed[0]!.event.seq).toBe("number");

    const transcript = readFileSync(
      join(conversationsDir, meta.id, "transcript.jsonl"),
      "utf8",
    );
    expect(transcript.trim()).toBe("");
  });

  it("does not publish when issueId is absent", async () => {
    const { createConversation, appendDelegation } = await loadService();
    const { subscribeFrames } = await import("./conversation-stream.js");

    const meta = await createConversation({
      title: "Unlinked delegation",
      projectId: "platform",
      model: "composer-2.5",
    });
    const streamed: unknown[] = [];
    const unsubscribe = subscribeFrames(meta.id, (frame) => {
      streamed.push(frame);
    });

    await appendDelegation(meta.id, {
      delegationId: "del-root",
      agentId: "agent-nested-1",
      role: "pinned-role",
      model: "auto",
    });
    unsubscribe();

    expect(streamed).toHaveLength(0);
  });
});

describe("appendEvent prompt live frames", () => {
  it("publishes one live prompt frame with the same seq as the persisted event", async () => {
    const { createConversation, appendEvent } = await loadService();
    const { subscribeFrames } = await import("./conversation-stream.js");

    const meta = await createConversation({
      title: "Prompt publish",
      projectId: "platform",
      model: "composer-2.5",
    });
    const streamed: Array<{
      persist: boolean;
      event: { type?: string; seq?: number; text?: string; at?: string };
    }> = [];
    const unsubscribe = subscribeFrames(meta.id, (frame) => {
      streamed.push(frame);
    });

    const persisted = await appendEvent(meta.id, {
      type: "prompt",
      text: "hello",
    });
    unsubscribe();

    expect(streamed).toHaveLength(1);
    expect(streamed[0]).toMatchObject({
      persist: false,
      event: {
        type: "prompt",
        text: "hello",
        seq: persisted.seq,
        at: persisted.at,
      },
    });
  });

  it("does not publish live frames for non-prompt appendEvent", async () => {
    const { createConversation, appendEvent } = await loadService();
    const { subscribeFrames } = await import("./conversation-stream.js");

    const meta = await createConversation({
      title: "No prompt publish",
      projectId: "platform",
      model: "composer-2.5",
    });
    const streamed: unknown[] = [];
    const unsubscribe = subscribeFrames(meta.id, (frame) => {
      streamed.push(frame);
    });

    await appendEvent(meta.id, { type: "assistant", text: "reply" });
    unsubscribe();

    expect(streamed).toHaveLength(0);
  });
});

describe("prompt assembly", () => {
  async function loadAttachments() {
    return import("./conversation-attachments.js");
  }

  it("sends text unchanged with no images when there are no attachments", async () => {
    const { createConversation, startConversationPrompt } = await loadService();
    const sessions = {
      sendPrompt: vi.fn(async () => ({
        ok: true as const,
        run: { id: "run-1" },
      })),
      getActiveRun: () => undefined,
    };

    const meta = await createConversation({
      title: "Plain send",
      projectId: "platform",
      model: "composer-2.5",
    });

    await startConversationPrompt(
      meta.id,
      "hello agent",
      undefined,
      sessions,
    );

    expect(sessions.sendPrompt).toHaveBeenCalledWith(meta.id, {
      prompt: "hello agent",
      model: undefined,
    });
  });

  it("appends an attachment block after the human text", async () => {
    const { conversationsDir } = await loadConfig();
    const { createConversation, startConversationPrompt, assembleAgentPrompt } =
      await loadService();
    const { putConversationAttachment } = await loadAttachments();
    const sessions = {
      sendPrompt: vi.fn(async () => ({
        ok: true as const,
        run: { id: "run-1" },
      })),
      getActiveRun: () => undefined,
    };

    const meta = await createConversation({
      title: "Attach block",
      projectId: "platform",
      model: "composer-2.5",
    });
    await putConversationAttachment(
      meta.id,
      "notes.txt",
      Buffer.from("context\n"),
    );
    const absolutePath = join(
      conversationsDir,
      meta.id,
      "attachments",
      "notes.txt",
    );

    await startConversationPrompt(
      meta.id,
      "review this",
      undefined,
      sessions,
      { attachments: ["notes.txt"] },
    );

    expect(sessions.sendPrompt).toHaveBeenCalledWith(meta.id, {
      prompt: `review this\n\nAttachments:\n- notes.txt — ${absolutePath}`,
      model: undefined,
    });

    const { readConversation } = await loadService();
    const { transcript } = readConversation(meta.id);
    expect(transcript[0]).toMatchObject({
      type: "prompt",
      text: "review this",
      attachments: ["notes.txt"],
    });

    const assembled = await assembleAgentPrompt(meta.id, "review this", [
      "notes.txt",
    ]);
    expect(assembled).toEqual({
      prompt: `review this\n\nAttachments:\n- notes.txt — ${absolutePath}`,
    });
    expect(assembled.images).toBeUndefined();
  });

  it("uses the attachment block alone when human text is empty", async () => {
    const { conversationsDir } = await loadConfig();
    const { createConversation, assembleAgentPrompt } = await loadService();
    const { putConversationAttachment } = await loadAttachments();

    const meta = await createConversation({
      title: "Attach only",
      projectId: "platform",
      model: "composer-2.5",
    });
    await putConversationAttachment(
      meta.id,
      "notes.txt",
      Buffer.from("context\n"),
    );
    const absolutePath = join(
      conversationsDir,
      meta.id,
      "attachments",
      "notes.txt",
    );

    const assembled = await assembleAgentPrompt(meta.id, "", ["notes.txt"]);
    expect(assembled).toEqual({
      prompt: `Attachments:\n- notes.txt — ${absolutePath}`,
    });
    expect(assembled.images).toBeUndefined();
  });

  it("includes one image payload for an image attachment", async () => {
    const { conversationsDir } = await loadConfig();
    const { createConversation, assembleAgentPrompt } = await loadService();
    const { putConversationAttachment } = await loadAttachments();
    const pngBytes = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);

    const meta = await createConversation({
      title: "Image attach",
      projectId: "platform",
      model: "composer-2.5",
    });
    await putConversationAttachment(meta.id, "diagram.png", pngBytes);
    const absolutePath = join(
      conversationsDir,
      meta.id,
      "attachments",
      "diagram.png",
    );

    const assembled = await assembleAgentPrompt(meta.id, "what is this?", [
      "diagram.png",
    ]);
    expect(assembled.prompt).toBe(
      `what is this?\n\nAttachments:\n- diagram.png — ${absolutePath}`,
    );
    expect(assembled.images).toEqual([
      {
        data: pngBytes.toString("base64"),
        mimeType: "image/png",
      },
    ]);
  });

  it("does not add images for a non-image attachment", async () => {
    const { conversationsDir } = await loadConfig();
    const { createConversation, assembleAgentPrompt } = await loadService();
    const { putConversationAttachment } = await loadAttachments();

    const meta = await createConversation({
      title: "File attach",
      projectId: "platform",
      model: "composer-2.5",
    });
    await putConversationAttachment(
      meta.id,
      "mock.tsx",
      Buffer.from("export const x = 1;\n"),
    );
    const absolutePath = join(
      conversationsDir,
      meta.id,
      "attachments",
      "mock.tsx",
    );

    const assembled = await assembleAgentPrompt(meta.id, "review", [
      "mock.tsx",
    ]);
    expect(assembled).toEqual({
      prompt: `review\n\nAttachments:\n- mock.tsx — ${absolutePath}`,
    });
    expect(assembled.images).toBeUndefined();
  });
});
