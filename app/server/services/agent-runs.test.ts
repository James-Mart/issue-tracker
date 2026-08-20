import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DelegationRecord, TranscriptEvent } from "../schemas.js";

const AT = "2026-07-09T14:00:00.000Z";
const AT_LATER = "2026-07-09T15:00:00.000Z";
const AT_END = "2026-07-09T16:00:00.000Z";
const ISSUE_ID = "linked-task";

let root: string;
let conversationsDir: string;

function writeConversation(
  id: string,
  opts: {
    delegations: DelegationRecord[];
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
  writeFileSync(
    join(dir, "delegations.jsonl"),
    opts.delegations.map((d) => JSON.stringify(d)).join("\n") +
      (opts.delegations.length ? "\n" : ""),
  );
  writeFileSync(
    join(dir, "transcript.jsonl"),
    opts.transcript.map((e) => JSON.stringify(e)).join("\n") +
      (opts.transcript.length ? "\n" : ""),
  );
}

function delegation(
  overrides: Partial<DelegationRecord> &
    Pick<
      DelegationRecord,
      "delegationId" | "agentId" | "role" | "model" | "at"
    >,
): DelegationRecord {
  return {
    delegationId: overrides.delegationId,
    agentId: overrides.agentId,
    role: overrides.role,
    model: overrides.model,
    at: overrides.at,
    ...(overrides.issueId !== undefined ? { issueId: overrides.issueId } : {}),
    ...(overrides.parentCallId !== undefined
      ? { parentCallId: overrides.parentCallId }
      : {}),
  };
}

function toolCall(
  callId: string,
  status: "running" | "completed" | "error",
  at: string,
): TranscriptEvent {
  return {
    type: "tool_call",
    callId,
    name: "delegate",
    status,
    at,
  };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "issue-tracker-agent-runs-"));
  conversationsDir = join(root, "conversations");
  mkdirSync(conversationsDir, { recursive: true });
  vi.resetModules();
  vi.stubEnv("ISSUES_DIR", join(root, "issues"));
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

async function loadListAgentRuns() {
  const mod = await import("./agent-runs.js");
  return mod.listAgentRunsForIssue;
}

describe("listAgentRunsForIssue", () => {
  it("resolves completed, running, errored, resumed, and legacy runs", async () => {
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
        }),
        delegation({
          delegationId: "del-resume-1",
          agentId: "agent-resume",
          role: "implementor",
          model: "composer-2.5",
          at: AT,
          issueId: ISSUE_ID,
          parentCallId: "call-resume-1",
        }),
        delegation({
          delegationId: "del-resume-2",
          agentId: "agent-resume",
          role: "implementor",
          model: "composer-2.5",
          at: AT_LATER,
          issueId: ISSUE_ID,
          parentCallId: "call-resume-2",
        }),
        delegation({
          delegationId: "del-legacy",
          agentId: "agent-legacy",
          role: "implementor",
          model: "composer-2.5",
          at: AT_LATER,
          issueId: ISSUE_ID,
        }),
      ],
      transcript: [
        toolCall("call-completed", "running", AT),
        toolCall("call-completed", "completed", AT_END),
        toolCall("call-running", "running", AT_LATER),
        toolCall("call-error", "running", AT_LATER),
        toolCall("call-error", "error", AT_END),
        toolCall("call-resume-1", "running", AT),
        toolCall("call-resume-1", "completed", AT_LATER),
        toolCall("call-resume-2", "running", AT_LATER),
        toolCall("call-resume-2", "completed", AT_END),
      ],
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
        }),
      ],
      transcript: [toolCall("call-other", "completed", AT_END)],
    });

    const listAgentRunsForIssue = await loadListAgentRuns();
    const runs = listAgentRunsForIssue(ISSUE_ID);

    expect(runs).toHaveLength(5);
    expect(runs.map((r) => r.delegationId)).toEqual([
      "del-completed",
      "del-resume-1",
      "del-running",
      "del-error",
      "del-resume-2",
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
  });
});
