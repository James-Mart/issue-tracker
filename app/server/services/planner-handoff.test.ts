import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { JSONL_LOCAL_AGENT_STORE_FILES } from "@cursor/sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DelegationRecordWithEnd, TranscriptEvent } from "../schemas.js";
import { fakeLauncherSessions } from "./queue-launcher.test-helpers.js";
import {
  AT,
  conversationPath,
  delegation,
  setupRunSequenceTest,
  teardownRunSequenceTest,
  writeConversation,
  writeIssue,
} from "./run-sequence.fixtures.js";

const T1 = "2026-07-09T14:01:00.000Z";
const T2 = "2026-07-09T14:02:00.000Z";
const T3 = "2026-07-09T14:03:00.000Z";
const PLANNER_ROLE = "issue-tracker-planner-opus";
const PLANNER_AGENT = "planner-agent";
const PLANNER_MODEL = '{"id":"claude-opus-5"}';
const CONFORMANCE_ROLE = "issue-tracker-design-conformance";
const AUTHOR_ROLE = "issue-tracker-mockup-author";
const AUTHOR_AGENT = "author-agent";

function writeJsonl(path: string, rows: readonly unknown[]): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, rows.map((row) => `${JSON.stringify(row)}\n`).join(""));
}

function readJsonl(path: string): Record<string, unknown>[] {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function readMeta(id: string): Record<string, unknown> {
  return JSON.parse(readFileSync(conversationPath(id, "meta.json"), "utf8"));
}

function seedConcludedIdea(ideaExtra: Record<string, unknown> = {}): void {
  writeIssue("cap", {
    kind: "idea",
    title: "cap",
    partOf: "p",
    archived: true,
    order: 1,
    createdAt: AT,
    updatedAt: AT,
    ...ideaExtra,
  });
  writeIssue("spec", {
    kind: "outline",
    title: "Feature outline",
    partOf: "p",
    bodyVersion: 1,
    sourceIdea: "cap",
    concludedAt: T3,
    order: 0,
    archived: false,
    createdAt: AT,
    updatedAt: AT,
  });
}

function runRow(runId: string, agentId: string, turnNumber: number, startedAt: string) {
  return {
    runId,
    agentId,
    turnNumber,
    status: "finished",
    createdAt: Date.parse(startedAt),
    updatedAt: Date.parse(startedAt),
    startedAt: Date.parse(startedAt),
    startCheckpointRef: null,
    latestCheckpointRef: { schemaVersion: 1, rootBlobId: `chk-${runId}` },
  };
}

function writeStore(dir: string, agentId: string, runs: unknown[]): void {
  writeJsonl(join(dir, JSONL_LOCAL_AGENT_STORE_FILES.runs), runs);
  writeJsonl(join(dir, JSONL_LOCAL_AGENT_STORE_FILES.agents), [
    { agentId, status: "idle", activeRunId: null, createdAt: 1, updatedAt: 1 },
  ]);
}

function seedPlanningConversation(
  id: string,
  transcript: TranscriptEvent[],
  delegations: DelegationRecordWithEnd[] = [],
): void {
  writeConversation(id, {
    transcript,
    delegations,
    meta: {
      title: "Plan cap",
      projectId: "p",
      issueId: "cap",
      channel: "planning",
      agentId: "root-agent",
      archived: false,
    },
  });
  writeStore(conversationPath(id, "agent-state"), "root-agent", [
    runRow("run-root", "root-agent", 1, T1),
  ]);
}

function delegateArgs(role: string, prompt: string) {
  return {
    providerIdentifier: "custom-user-tools",
    toolName: "delegate",
    args: { role, prompt },
  };
}

function delegateCall(
  callId: string,
  prompt: string,
  at: string,
  seq: number,
  role = PLANNER_ROLE,
): TranscriptEvent {
  return {
    type: "tool_call",
    callId,
    name: "mcp",
    status: "completed",
    args: delegateArgs(role, prompt),
    at,
    seq,
  };
}

/** A `delegate` call made by the run `delegationId`, which `parentCallId` spawned. */
function nestedDelegateCall(
  parentCallId: string,
  delegationId: string,
  callId: string,
  prompt: string,
  at: string,
  seq: number,
): TranscriptEvent {
  return {
    type: "subagent_update",
    parentCallId,
    delegationId,
    step: {
      kind: "tool_call",
      callId,
      name: "mcp",
      status: "completed",
      args: delegateArgs(AUTHOR_ROLE, prompt),
    },
    at,
    seq,
  };
}

function nestedText(
  callId: string,
  delegationId: string,
  text: string,
  at: string,
  seq: number,
  parentDelegationId?: string,
): TranscriptEvent {
  return {
    type: "subagent_update",
    parentCallId: callId,
    delegationId,
    ...(parentDelegationId ? { parentDelegationId } : {}),
    step: { kind: "text", text },
    at,
    seq,
  };
}

function seedAutoPlanConversation(): void {
  seedPlanningConversation(
    "plan-cap",
    [
      { type: "prompt", text: "Auto-plan cap", at: AT, seq: 1 },
      delegateCall("call-1", "Plan cap in the issue tracker.", T1, 2),
      nestedText("call-1", "d-1", "Which ref should this build on?", T1, 3),
      nestedText("call-r", "d-r", "Research summary.", T1, 4, "d-1"),
      delegateCall("call-2", "Agreed — main.", T2, 5),
      nestedText("call-2", "d-2", "Concluded onto spec.", T2, 6),
      { type: "assistant", text: "Audit written.", at: T3, seq: 7 },
    ],
    [
      delegation({
        delegationId: "d-0",
        agentId: "disc-agent",
        role: "issue-tracker-auto-plan-discriminator",
        model: PLANNER_MODEL,
        at: AT,
        parentCallId: "call-0",
      }),
      delegation({
        delegationId: "d-1",
        agentId: PLANNER_AGENT,
        role: PLANNER_ROLE,
        model: PLANNER_MODEL,
        at: T1,
        parentCallId: "call-1",
      }),
      delegation({
        delegationId: "d-r",
        agentId: "research-agent",
        role: "issue-tracker-research",
        model: PLANNER_MODEL,
        at: T1,
        parentCallId: "call-r",
        parentDelegationId: "d-1",
      }),
      delegation({
        delegationId: "d-2",
        agentId: PLANNER_AGENT,
        role: PLANNER_ROLE,
        model: PLANNER_MODEL,
        at: T2,
        parentCallId: "call-2",
      }),
    ],
  );
  writeStore(
    conversationPath("plan-cap", "agent-state", "nested", PLANNER_AGENT),
    PLANNER_AGENT,
    [
      runRow("run-p1", PLANNER_AGENT, 1, T1),
      runRow("run-p2", PLANNER_AGENT, 2, T2),
    ],
  );
}

/** Design conformance spawns the mockup author and resumes it. */
function seedMockupRoundConversation(): void {
  seedPlanningConversation(
    "plan-cap",
    [
      { type: "prompt", text: "Plan cap", at: AT, seq: 1 },
      delegateCall("call-c", "Run a mockup round.", T1, 2, CONFORMANCE_ROLE),
      nestedDelegateCall("call-c", "d-c", "call-a1", "Mock up the tab.", T1, 3),
      nestedText("call-a1", "d-a1", "Direction tab is ready.", T1, 4, "d-c"),
      nestedDelegateCall("call-c", "d-c", "call-a2", "Tighten the spacing.", T2, 5),
      nestedText("call-a2", "d-a2", "Spacing tightened.", T2, 6, "d-c"),
      { type: "assistant", text: "Concluded onto spec.", at: T3, seq: 7 },
    ],
    [
      delegation({
        delegationId: "d-c",
        agentId: "conformance-agent",
        role: CONFORMANCE_ROLE,
        model: PLANNER_MODEL,
        at: T1,
        parentCallId: "call-c",
      }),
      delegation({
        delegationId: "d-a1",
        agentId: AUTHOR_AGENT,
        role: AUTHOR_ROLE,
        model: PLANNER_MODEL,
        at: T1,
        parentCallId: "call-a1",
        parentDelegationId: "d-c",
      }),
      delegation({
        delegationId: "d-a2",
        agentId: AUTHOR_AGENT,
        role: AUTHOR_ROLE,
        model: PLANNER_MODEL,
        at: T2,
        parentCallId: "call-a2",
        parentDelegationId: "d-c",
      }),
    ],
  );
  writeStore(
    conversationPath("plan-cap", "agent-state", "nested", "conformance-agent"),
    "conformance-agent",
    [runRow("run-c", "conformance-agent", 1, T1)],
  );
  writeStore(
    conversationPath("plan-cap", "agent-state", "nested", AUTHOR_AGENT),
    AUTHOR_AGENT,
    [
      runRow("run-a1", AUTHOR_AGENT, 1, T1),
      runRow("run-a2", AUTHOR_AGENT, 2, T2),
    ],
  );
}

beforeEach(() => {
  setupRunSequenceTest();
  writeIssue("p", {
    kind: "project",
    title: "P",
    workspace: "/tmp/repo",
    order: 0,
    createdAt: AT,
    updatedAt: AT,
  });
});

afterEach(teardownRunSequenceTest);

describe("handoffPlanner", () => {
  it("promotes the planner the stakeholder delegated to, with their exchange as its transcript", async () => {
    seedConcludedIdea({ stakeholder: "claude-opus-5-5-thinking-high" });
    seedAutoPlanConversation();
    const { sessions } = fakeLauncherSessions();
    const { handoffPlanner } = await import("./planner-handoff.js");
    const { loadRoleModelPin } = await import("./role-bodies.js");

    const meta = await handoffPlanner(
      { outlineId: "spec", mode: "promote", sourceConversationId: "plan-cap" },
      sessions,
    );

    expect(readMeta(meta.id)).toMatchObject({
      issueId: "spec",
      channel: "planning",
      outlineRole: "planner",
      role: PLANNER_ROLE,
      model: loadRoleModelPin(PLANNER_ROLE),
      forkedFrom: "plan-cap",
      forkedAtSeq: 7,
    });
    expect(
      readJsonl(conversationPath(meta.id, "transcript.jsonl")).map((e) => [
        e.type,
        e.text,
        e.seq,
      ]),
    ).toEqual([
      ["prompt", "Plan cap in the issue tracker.", 1],
      ["assistant", "Which ref should this build on?", 2],
      ["prompt", "Agreed — main.", 3],
      ["assistant", "Concluded onto spec.", 4],
    ]);
    const runs = readJsonl(
      conversationPath(meta.id, "agent-state", JSONL_LOCAL_AGENT_STORE_FILES.runs),
    );
    expect(runs.map((run) => [run.runId, run.agentId])).toEqual([
      ["run-p1", meta.agentId],
      ["run-p2", meta.agentId],
    ]);
    expect(
      existsSync(conversationPath(meta.id, "agent-state", "nested")),
    ).toBe(false);
    expect(readMeta("plan-cap").archived).toBe(true);
  });

  it("forks the mockup author onto the outline's mockups channel, bound to its Storybook", async () => {
    seedConcludedIdea();
    seedMockupRoundConversation();
    const { sessions, started } = fakeLauncherSessions();
    const { handoffPlanner } = await import("./planner-handoff.js");
    const { readBoundSession } = await import("./outline-mockup-store.js");
    const { loadRoleModelPin } = await import("./role-bodies.js");
    const { listConversations } = await import("./conversations.js");

    const planner = await handoffPlanner(
      { outlineId: "spec", mode: "fork", sourceConversationId: "plan-cap" },
      sessions,
    );

    const [author] = listConversations().filter(
      (meta) => meta.issueId === "spec" && meta.channel === "mockups",
    );
    expect(author).toBeDefined();
    expect(readMeta(author!.id)).toMatchObject({
      title: "Mockups Feature outline",
      issueId: "spec",
      channel: "mockups",
      outlineRole: "mockup-author",
      role: AUTHOR_ROLE,
      model: loadRoleModelPin(AUTHOR_ROLE),
      forkedFrom: "plan-cap",
      forkedAtSeq: 7,
      archived: false,
    });
    expect(author!.agentId).not.toBe(AUTHOR_AGENT);
    expect(author!.agentId).not.toBe(planner.agentId);
    expect(readBoundSession("spec")).toBe(author!.id);
    expect(
      readJsonl(conversationPath(author!.id, "transcript.jsonl")).map((e) => [
        e.type,
        e.text,
        e.seq,
      ]),
    ).toEqual([
      ["prompt", "Mock up the tab.", 1],
      ["assistant", "Direction tab is ready.", 2],
      ["prompt", "Tighten the spacing.", 3],
      ["assistant", "Spacing tightened.", 4],
    ]);
    const runs = readJsonl(
      conversationPath(author!.id, "agent-state", JSONL_LOCAL_AGENT_STORE_FILES.runs),
    );
    expect(runs.map((run) => [run.runId, run.agentId])).toEqual([
      ["run-a1", author!.agentId],
      ["run-a2", author!.agentId],
    ]);
    expect(
      readJsonl(
        conversationPath(author!.id, "agent-state", JSONL_LOCAL_AGENT_STORE_FILES.agents),
      ),
    ).toEqual([
      expect.objectContaining({
        agentId: author!.agentId,
        status: "idle",
        activeRunId: null,
      }),
    ]);
    expect(started).toEqual([]);
    expect(readMeta(planner.id)).toMatchObject({
      channel: "planning",
      outlineRole: "planner",
    });
    expect(readMeta("plan-cap").archived).toBe(true);
  });
});
