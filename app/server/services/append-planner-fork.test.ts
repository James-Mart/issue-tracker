import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { JSONL_LOCAL_AGENT_STORE_FILES } from "@cursor/sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AT,
  conversationPath,
  prompt,
  setupRunSequenceTest,
  teardownRunSequenceTest,
  writeConversation,
  writeIssue,
} from "./run-sequence.fixtures.js";

const PLANNER_AT = "2026-07-09T14:01:00.000Z";
const PLANNER_ROLE = "issue-tracker-planner-grok";
const STAKEHOLDER = "cursor-grok-4.7";
const idle = { isBusy: () => false, claimStart: () => ({ release() {} }) };

function writeJsonl(path: string, rows: readonly unknown[]): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, rows.map((row) => `${JSON.stringify(row)}\n`).join(""));
}

function seedGraph(): void {
  writeIssue("platform", {
    kind: "project",
    title: "Platform",
    workspace: "/tmp/repo",
    order: 0,
    createdAt: AT,
    updatedAt: AT,
  });
  writeIssue("origin", {
    kind: "idea",
    title: "Origin",
    partOf: "platform",
    stakeholder: STAKEHOLDER,
    order: 1,
    createdAt: AT,
    updatedAt: AT,
  });
  writeIssue("spec", {
    kind: "outline",
    title: "Feature outline",
    partOf: "platform",
    bodyVersion: 1,
    sourceIdea: "origin",
    order: 2,
    createdAt: AT,
    updatedAt: AT,
  });
  writeIssue("target", {
    kind: "story",
    title: "Target",
    partOf: "platform",
    sourceOutline: { outline: "spec", version: 1 },
    order: 3,
    createdAt: AT,
    updatedAt: AT,
  });
  writeIssue("append-idea", {
    kind: "idea",
    title: "Append",
    partOf: "platform",
    appendTo: "target",
    order: 4,
    createdAt: AT,
    updatedAt: AT,
  });
}

function seedPlanner(extra: Record<string, unknown> = {}): void {
  writeConversation("outline-planner", {
    transcript: [prompt("OUTLINE PLANNER CONTEXT", PLANNER_AT, 1)],
    meta: {
      title: "Plan feature",
      projectId: "platform",
      issueId: "spec",
      channel: "planning",
      outlineRole: "planner",
      model: "composer-2.5",
      role: PLANNER_ROLE,
      agentId: "planner-agent",
      ...extra,
    },
  });
  writeJsonl(conversationPath("outline-planner", "agent-state", JSONL_LOCAL_AGENT_STORE_FILES.runs), [
    {
      runId: "run-planner",
      agentId: "planner-agent",
      turnNumber: 1,
      status: "finished",
      createdAt: Date.parse(PLANNER_AT),
      updatedAt: Date.parse(PLANNER_AT),
      startedAt: Date.parse(PLANNER_AT),
      startCheckpointRef: null,
      latestCheckpointRef: { schemaVersion: 1, rootBlobId: "chk-planner" },
    },
  ]);
  writeJsonl(conversationPath("outline-planner", "agent-state", JSONL_LOCAL_AGENT_STORE_FILES.agents), [
    {
      agentId: "planner-agent",
      status: "idle",
      activeRunId: null,
      createdAt: 1,
      updatedAt: 1,
    },
  ]);
}

beforeEach(() => {
  setupRunSequenceTest();
  seedGraph();
});

afterEach(() => {
  teardownRunSequenceTest();
});

async function start(message: string, model = "cursor-grok-4.7") {
  const { createIssueChannelSession, listConversations } = await import(
    "./conversations.js"
  );
  const { meta } = await createIssueChannelSession(
    {
      issueId: "append-idea",
      channel: "planning",
      projectId: "platform",
      title: "Plan Append",
      model,
      message,
    },
    idle,
  );
  const transcript = readFileSync(conversationPath(meta.id, "transcript.jsonl"), "utf8");
  return { meta, transcript, sessions: listConversations() };
}

describe("createIssueChannelSession append planner fork", () => {
  it("forks the outline planner into the append Idea's planning session", async () => {
    seedPlanner();
    const { meta, transcript, sessions } = await start("Plan the append.");

    expect(meta).toMatchObject({
      issueId: "append-idea",
      channel: "planning",
      forkedFrom: "outline-planner",
      forkedAtSeq: 1,
      model: "composer-2.5",
      role: PLANNER_ROLE,
    });
    expect(transcript).toContain("OUTLINE PLANNER CONTEXT");
    expect(transcript).toContain("Plan the append.");
    expect(
      existsSync(conversationPath(meta.id, "agent-state", JSONL_LOCAL_AGENT_STORE_FILES.runs)),
    ).toBe(true);
    expect(sessions.find((session) => session.id === "outline-planner")).toMatchObject({
      archived: false,
      issueId: "spec",
    });
  });
});
