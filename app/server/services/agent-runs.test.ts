import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  DelegationRecord,
  DelegationRecordWithEnd,
  TranscriptEvent,
} from "../schemas.js";

const AT = "2026-07-09T14:00:00.000Z";
const AT_LATER = "2026-07-09T15:00:00.000Z";
const AT_END = "2026-07-09T16:00:00.000Z";
const ISSUE_ID = "linked-task";

let root: string;
let conversationsDir: string;
let issuesRoot: string;

function writeIssue(id: string, body: Record<string, unknown>): void {
  mkdirSync(join(issuesRoot, id), { recursive: true });
  writeFileSync(join(issuesRoot, id, "issue.json"), JSON.stringify({ id, ...body }));
}

function writeConversationMeta(
  id: string,
  overrides: Record<string, unknown> = {},
): void {
  const dir = join(conversationsDir, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "meta.json"),
    `${JSON.stringify(
      {
        id,
        title: "Test conversation",
        projectId: "platform",
        model: "composer-2.5",
        createdAt: AT,
        updatedAt: AT,
        ...overrides,
      },
      null,
      2,
    )}\n`,
  );
}

function writeConversation(
  id: string,
  opts: {
    delegations: DelegationRecordWithEnd[];
    transcript: TranscriptEvent[];
  },
): void {
  const dir = join(conversationsDir, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "meta.json"),
    `${JSON.stringify(
      {
        id,
        title: "Test conversation",
        projectId: "platform",
        model: "composer-2.5",
        createdAt: AT,
        updatedAt: AT,
      },
      null,
      2,
    )}\n`,
  );
  const lines: unknown[] = [];
  for (const record of opts.delegations) {
    const { end, ...start } = record;
    lines.push(start);
    if (end !== undefined) {
      lines.push({
        kind: "end",
        delegationId: start.delegationId,
        status: end.status,
        endedAt: end.endedAt,
        ...(end.failureClass !== undefined
          ? { failureClass: end.failureClass }
          : {}),
      });
    }
  }
  writeFileSync(
    join(dir, "delegations.jsonl"),
    lines.map((line) => JSON.stringify(line)).join("\n") +
      (lines.length ? "\n" : ""),
  );
  writeFileSync(
    join(dir, "transcript.jsonl"),
    opts.transcript.map((e) => JSON.stringify(e)).join("\n") +
      (opts.transcript.length ? "\n" : ""),
  );
}

function delegation(
  overrides: Partial<DelegationRecordWithEnd> &
    Pick<
      DelegationRecord,
      "delegationId" | "agentId" | "role" | "model" | "at"
    >,
): DelegationRecordWithEnd {
  const lifecycle =
    "lifecycle" in overrides ? overrides.lifecycle : "tracked";
  return {
    delegationId: overrides.delegationId,
    agentId: overrides.agentId,
    role: overrides.role,
    model: overrides.model,
    at: overrides.at,
    ...(lifecycle !== undefined ? { lifecycle } : {}),
    ...(overrides.issueId !== undefined ? { issueId: overrides.issueId } : {}),
    ...(overrides.parentCallId !== undefined
      ? { parentCallId: overrides.parentCallId }
      : {}),
    ...(overrides.end !== undefined ? { end: overrides.end } : {}),
  };
}

function subagentUpdate(
  parentCallId: string,
  seq: number,
  text: string,
): TranscriptEvent {
  return {
    type: "subagent_update",
    parentCallId,
    step: { kind: "text", text },
    at: AT,
    seq,
  };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "issue-tracker-agent-runs-"));
  conversationsDir = join(root, "conversations");
  issuesRoot = join(root, "issues");
  mkdirSync(conversationsDir, { recursive: true });
  mkdirSync(issuesRoot, { recursive: true });
  vi.resetModules();
  vi.stubEnv("ISSUES_DIR", issuesRoot);
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

async function loadAgentRunsService() {
  const mod = await import("./agent-runs.js");
  return mod;
}

describe("listAgentRunsForIssue", () => {
  it("resolves completed, running, errored, resumed, and unknown runs from the delegation store", async () => {
    writeConversation("conv-main", {
      delegations: [
        delegation({
          delegationId: "del-completed",
          agentId: "agent-impl",
          role: "implementor",
          model: "composer-2.5",
          at: AT,
          issueId: ISSUE_ID,
          parentCallId: "call-completed",
          end: { status: "completed", endedAt: AT_END },
        }),
        delegation({
          delegationId: "del-running",
          agentId: "agent-running",
          role: "validator",
          model: "composer-2.5",
          at: AT_LATER,
          issueId: ISSUE_ID,
          parentCallId: "call-running",
        }),
        delegation({
          delegationId: "del-error",
          agentId: "agent-error",
          role: "implementor",
          model: "composer-2.5",
          at: AT_LATER,
          issueId: ISSUE_ID,
          parentCallId: "call-error",
          end: { status: "error", endedAt: AT_END },
        }),
        delegation({
          delegationId: "del-resume-1",
          agentId: "agent-resume",
          role: "implementor",
          model: "composer-2.5",
          at: AT,
          issueId: ISSUE_ID,
          parentCallId: "call-resume-1",
          end: { status: "completed", endedAt: AT_LATER },
        }),
        delegation({
          delegationId: "del-resume-2",
          agentId: "agent-resume",
          role: "implementor",
          model: "composer-2.5",
          at: AT_LATER,
          issueId: ISSUE_ID,
          parentCallId: "call-resume-2",
          end: { status: "completed", endedAt: AT_END },
        }),
        delegation({
          delegationId: "del-legacy",
          agentId: "agent-legacy",
          role: "implementor",
          model: "composer-2.5",
          at: AT_LATER,
          issueId: ISSUE_ID,
          parentCallId: "call-legacy",
          lifecycle: undefined,
        }),
        delegation({
          delegationId: "del-no-call",
          agentId: "agent-no-call",
          role: "implementor",
          model: "composer-2.5",
          at: AT_LATER,
          issueId: ISSUE_ID,
        }),
      ],
      transcript: [],
    });

    writeConversation("conv-other-issue", {
      delegations: [
        delegation({
          delegationId: "del-other",
          agentId: "agent-other",
          role: "implementor",
          model: "composer-2.5",
          at: AT,
          issueId: "other-task",
          parentCallId: "call-other",
          end: { status: "completed", endedAt: AT_END },
        }),
      ],
      transcript: [],
    });

    const { listAgentRunsForIssue } = await loadAgentRunsService();
    const runs = listAgentRunsForIssue(ISSUE_ID);

    expect(runs).toHaveLength(6);
    expect(runs.map((r) => r.delegationId)).toEqual([
      "del-completed",
      "del-resume-1",
      "del-running",
      "del-error",
      "del-resume-2",
      "del-legacy",
    ]);

    expect(runs[0]).toMatchObject({
      delegationId: "del-completed",
      status: "completed",
      endedAt: AT_END,
      isResume: false,
      conversationId: "conv-main",
    });

    expect(runs[1]).toMatchObject({
      delegationId: "del-resume-1",
      agentId: "agent-resume",
      status: "completed",
      endedAt: AT_LATER,
      isResume: false,
    });

    expect(runs[2]).toMatchObject({
      delegationId: "del-running",
      status: "running",
      isResume: false,
    });
    expect(runs[2]).not.toHaveProperty("endedAt");

    expect(runs[3]).toMatchObject({
      delegationId: "del-error",
      status: "error",
      endedAt: AT_END,
      isResume: false,
    });

    expect(runs[4]).toMatchObject({
      delegationId: "del-resume-2",
      agentId: "agent-resume",
      status: "completed",
      endedAt: AT_END,
      isResume: true,
    });

    expect(runs[5]).toMatchObject({
      delegationId: "del-legacy",
      status: "unknown",
      isResume: false,
    });
    expect(runs[5]).not.toHaveProperty("endedAt");
  });

  it("reports terminal status from an end record without a matching transcript row", async () => {
    writeConversation("conv-nested", {
      delegations: [
        delegation({
          delegationId: "del-nested",
          agentId: "agent-nested",
          role: "implementor",
          model: "composer-2.5",
          at: AT,
          issueId: ISSUE_ID,
          parentCallId: "call-nested",
          end: { status: "completed", endedAt: AT_END },
        }),
      ],
      transcript: [
        subagentUpdate("call-nested", 1, "nested step only"),
      ],
    });

    const { listAgentRunsForIssue } = await loadAgentRunsService();
    const runs = listAgentRunsForIssue(ISSUE_ID);

    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      delegationId: "del-nested",
      status: "completed",
      endedAt: AT_END,
    });
  });

  it("reports running for a tracked record without an end", async () => {
    writeConversation("conv-open", {
      delegations: [
        delegation({
          delegationId: "del-open",
          agentId: "agent-open",
          role: "implementor",
          model: "composer-2.5",
          at: AT,
          issueId: ISSUE_ID,
          parentCallId: "call-open",
          lifecycle: "tracked",
        }),
      ],
      transcript: [],
    });

    const { listAgentRunsForIssue } = await loadAgentRunsService();
    const runs = listAgentRunsForIssue(ISSUE_ID);

    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      delegationId: "del-open",
      status: "running",
    });
    expect(runs[0]).not.toHaveProperty("endedAt");
  });

  it("reports unknown for an untracked record without an end", async () => {
    writeConversation("conv-untracked", {
      delegations: [
        delegation({
          delegationId: "del-untracked",
          agentId: "agent-untracked",
          role: "implementor",
          model: "composer-2.5",
          at: AT,
          issueId: ISSUE_ID,
          parentCallId: "call-untracked",
          lifecycle: undefined,
        }),
      ],
      transcript: [],
    });

    const { listAgentRunsForIssue } = await loadAgentRunsService();
    const runs = listAgentRunsForIssue(ISSUE_ID);

    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      delegationId: "del-untracked",
      status: "unknown",
    });
    expect(runs[0]).not.toHaveProperty("endedAt");
  });
});

describe("findAgentRunsWorkRoot", () => {
  it("resolves a Task under an Epic-child Story to the Epic implementing conversation", async () => {
    writeIssue("platform", {
      kind: "project",
      title: "Platform",
      createdAt: AT,
      updatedAt: AT,
    });
    writeIssue("ship-it", {
      kind: "epic",
      title: "Ship it",
      partOf: "platform",
      createdAt: AT,
      updatedAt: AT,
    });
    writeIssue("linked-story", {
      kind: "story",
      title: "Linked story",
      partOf: "ship-it",
      createdAt: AT,
      updatedAt: AT,
    });
    writeIssue(ISSUE_ID, {
      kind: "task",
      title: "Linked task",
      partOf: "linked-story",
      createdAt: AT,
      updatedAt: AT,
    });

    writeConversationMeta("conv-old", {
      issueId: "ship-it",
      channel: "implementing",
      updatedAt: "2026-07-09T13:00:00.000Z",
    });
    writeConversationMeta("conv-new", {
      issueId: "ship-it",
      channel: "implementing",
      updatedAt: AT_LATER,
    });
    writeConversationMeta("conv-archived", {
      issueId: "ship-it",
      channel: "implementing",
      archived: true,
      updatedAt: "2026-07-09T17:00:00.000Z",
    });

    const { findAgentRunsWorkRoot } = await loadAgentRunsService();
    const { readAll } = await import("./issues.js");
    const { issues } = readAll();

    expect(findAgentRunsWorkRoot(ISSUE_ID, issues)).toEqual({
      issueId: "ship-it",
      conversationId: "conv-new",
    });
  });

  it("omits workRoot when the root has no implementing conversation", async () => {
    writeIssue("platform", {
      kind: "project",
      title: "Platform",
      createdAt: AT,
      updatedAt: AT,
    });
    writeIssue("ship-it", {
      kind: "epic",
      title: "Ship it",
      partOf: "platform",
      createdAt: AT,
      updatedAt: AT,
    });
    writeIssue(ISSUE_ID, {
      kind: "task",
      title: "Linked task",
      partOf: "ship-it",
      createdAt: AT,
      updatedAt: AT,
    });

    writeConversationMeta("conv-planning", {
      issueId: "ship-it",
      channel: "planning",
    });

    const { findAgentRunsWorkRoot } = await loadAgentRunsService();
    const { readAll } = await import("./issues.js");
    const { issues } = readAll();

    expect(findAgentRunsWorkRoot(ISSUE_ID, issues)).toBeUndefined();
  });
});

describe("listAgentRunEvents", () => {
  it("returns subagent_update events for one run in seq order, excluding siblings", async () => {
    writeConversation("conv-main", {
      delegations: [
        delegation({
          delegationId: "del-a",
          agentId: "agent-a",
          role: "implementor",
          model: "composer-2.5",
          at: AT,
          issueId: ISSUE_ID,
          parentCallId: "call-a",
          end: { status: "completed", endedAt: AT_END },
        }),
        delegation({
          delegationId: "del-b",
          agentId: "agent-b",
          role: "validator",
          model: "composer-2.5",
          at: AT_LATER,
          issueId: ISSUE_ID,
          parentCallId: "call-b",
          end: { status: "completed", endedAt: AT_END },
        }),
      ],
      transcript: [
        subagentUpdate("call-a", 2, "first run step 1"),
        subagentUpdate("call-b", 3, "sibling run step"),
        subagentUpdate("call-a", 4, "first run step 2"),
        subagentUpdate("call-b", 6, "sibling run step 2"),
      ],
    });

    const { listAgentRunEvents } = await loadAgentRunsService();

    const eventsA = listAgentRunEvents(ISSUE_ID, "del-a");
    expect(eventsA).toHaveLength(2);
    expect(eventsA!.map((e) => e.step)).toEqual([
      { kind: "text", text: "first run step 1" },
      { kind: "text", text: "first run step 2" },
    ]);
    expect(eventsA!.map((e) => e.seq)).toEqual([2, 4]);

    const eventsB = listAgentRunEvents(ISSUE_ID, "del-b");
    expect(eventsB).toHaveLength(2);
    expect(eventsB!.map((e) => e.step)).toEqual([
      { kind: "text", text: "sibling run step" },
      { kind: "text", text: "sibling run step 2" },
    ]);
  });

  it("returns events for an unknown run without treating it as still open", async () => {
    writeConversation("conv-untracked", {
      delegations: [
        delegation({
          delegationId: "del-untracked",
          agentId: "agent-untracked",
          role: "implementor",
          model: "composer-2.5",
          at: AT,
          issueId: ISSUE_ID,
          parentCallId: "call-untracked",
          lifecycle: undefined,
        }),
      ],
      transcript: [
        subagentUpdate("call-untracked", 1, "legacy nested step"),
      ],
    });

    const { listAgentRunEvents } = await loadAgentRunsService();
    const events = listAgentRunEvents(ISSUE_ID, "del-untracked");

    expect(events).toHaveLength(1);
    expect(events![0]!.step).toEqual({
      kind: "text",
      text: "legacy nested step",
    });
  });

  it("returns undefined for an unknown delegationId", async () => {
    writeConversation("conv-main", {
      delegations: [
        delegation({
          delegationId: "del-a",
          agentId: "agent-a",
          role: "implementor",
          model: "composer-2.5",
          at: AT,
          issueId: ISSUE_ID,
          parentCallId: "call-a",
          end: { status: "completed", endedAt: AT_END },
        }),
      ],
      transcript: [],
    });

    const { listAgentRunEvents } = await loadAgentRunsService();
    expect(listAgentRunEvents(ISSUE_ID, "del-missing")).toBeUndefined();
  });
});
