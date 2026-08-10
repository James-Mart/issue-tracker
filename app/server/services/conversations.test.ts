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
});
