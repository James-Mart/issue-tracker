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

function delegateCall(callId: string, prompt: string, at: string, seq: number): TranscriptEvent {
  return {
    type: "tool_call",
    callId,
    name: "mcp",
    status: "completed",
    args: {
      providerIdentifier: "custom-user-tools",
      toolName: "delegate",
      args: { role: PLANNER_ROLE, prompt },
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
});
