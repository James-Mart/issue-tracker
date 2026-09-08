import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { expect, vi } from "vitest";
import type {
  DelegationRecord,
  DelegationRecordWithEnd,
  TranscriptEvent,
} from "../schemas.js";
import type { RunSequenceSection } from "./run-sequence.js";

export const AT = "2026-07-09T14:00:00.000Z";
export const AT_EARLY = "2026-07-09T13:00:00.000Z";
export const AT_CHILD = "2026-07-09T14:05:00.000Z";
export const AT_END = "2026-07-09T14:00:05.000Z";
export const AT_ROUND1_END = "2026-07-09T14:00:03.000Z";
export const AT_ROUND2_END = "2026-07-09T14:00:06.000Z";
export const AT_ROUND3_END = "2026-07-09T14:00:09.000Z";
export const AT_LATE = "2026-07-09T16:00:00.000Z";
export const AT_LATE_END = "2026-07-09T16:00:06.000Z";

let root: string;
let conversationsDir: string;
let issuesDir: string;

export function writeIssue(id: string, body: Record<string, unknown>): void {
  mkdirSync(join(issuesDir, id), { recursive: true });
  writeFileSync(
    join(issuesDir, id, "issue.json"),
    JSON.stringify({ id, ...body }),
  );
}

export function writeConversation(
  id: string,
  opts: {
    delegations?: DelegationRecordWithEnd[];
    transcript?: TranscriptEvent[];
    meta?: Record<string, unknown>;
  } = {},
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
        ...opts.meta,
      },
      null,
      2,
    )}\n`,
  );
  const lines: unknown[] = [];
  for (const record of opts.delegations ?? []) {
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
  const transcript = opts.transcript ?? [];
  writeFileSync(
    join(dir, "transcript.jsonl"),
    transcript.map((e) => JSON.stringify(e)).join("\n") +
      (transcript.length ? "\n" : ""),
  );
}

export function writeRunLiveMarker(conversationId: string): void {
  writeFileSync(
    join(conversationsDir, conversationId, "run-live.json"),
    `${JSON.stringify({ pid: process.pid })}\n`,
  );
}

export function delegation(
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
    ...(overrides.parentDelegationId !== undefined
      ? { parentDelegationId: overrides.parentDelegationId }
      : {}),
    ...(overrides.end !== undefined ? { end: overrides.end } : {}),
  };
}

export function toolCall(
  callId: string,
  status: "running" | "completed" | "error",
  at: string,
  seq: number,
): TranscriptEvent {
  return {
    type: "tool_call",
    callId,
    name: "delegate",
    status,
    at,
    seq,
  };
}

export function subagentToolCall(
  opts: {
    parentCallId: string;
    callId: string;
    status: "running" | "completed" | "error";
    at: string;
    seq: number;
    delegationId?: string;
  },
): TranscriptEvent {
  return {
    type: "subagent_update",
    parentCallId: opts.parentCallId,
    step: {
      kind: "tool_call",
      callId: opts.callId,
      name: "delegate",
      status: opts.status,
    },
    at: opts.at,
    seq: opts.seq,
    ...(opts.delegationId !== undefined
      ? { delegationId: opts.delegationId }
      : {}),
  };
}

export function prompt(text: string, at: string, seq: number): TranscriptEvent {
  return { type: "prompt", text, at, seq };
}

export function usage(opts: {
  totalTokens: number;
  at: string;
  seq: number;
  parentCallId?: string;
}): TranscriptEvent {
  return {
    type: "usage",
    usage: {
      inputTokens: opts.totalTokens,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: opts.totalTokens,
    },
    at: opts.at,
    seq: opts.seq,
    ...(opts.parentCallId !== undefined
      ? { parentCallId: opts.parentCallId }
      : {}),
  };
}

export function writeWorkTree(): void {
  writeIssue("proj", {
    kind: "project",
    title: "Proj",
    createdAt: AT,
    updatedAt: AT,
  });
  writeIssue("epic-one", {
    kind: "epic",
    title: "Epic One",
    partOf: "proj",
    createdAt: AT,
    updatedAt: AT,
  });
  writeIssue("story-one", {
    kind: "story",
    title: "Story One",
    partOf: "epic-one",
    createdAt: AT,
    updatedAt: AT,
  });
  writeIssue("task-a", {
    kind: "task",
    title: "Task A",
    partOf: "story-one",
    createdAt: AT,
    updatedAt: AT,
  });
  writeIssue("task-b", {
    kind: "task",
    title: "Task B",
    partOf: "story-one",
    createdAt: AT,
    updatedAt: AT,
  });
}

export function expectLeafCoverage(
  sections: RunSequenceSection[],
  beatCount: number,
): void {
  const covered: number[] = [];
  function walk(nodes: RunSequenceSection[]): void {
    for (let i = 1; i < nodes.length; i += 1) {
      expect(nodes[i]!.beatStart).toBe(nodes[i - 1]!.beatEnd + 1);
    }
    for (const node of nodes) {
      expect(node.beatStart).toBeLessThanOrEqual(node.beatEnd);
      if (node.children.length === 0) {
        for (let i = node.beatStart; i <= node.beatEnd; i += 1) {
          covered.push(i);
        }
      } else {
        expect(node.children[0]!.beatStart).toBe(node.beatStart);
        expect(node.children[node.children.length - 1]!.beatEnd).toBe(
          node.beatEnd,
        );
        walk(node.children);
      }
    }
  }
  walk(sections);
  expect(covered).toEqual([...Array(beatCount).keys()]);
}

export function setupRunSequenceTest(): void {
  root = mkdtempSync(join(tmpdir(), "issue-tracker-run-sequence-"));
  conversationsDir = join(root, "conversations");
  issuesDir = join(root, "issues");
  mkdirSync(conversationsDir, { recursive: true });
  mkdirSync(issuesDir, { recursive: true });
  vi.resetModules();
  vi.stubEnv("ISSUES_DIR", issuesDir);
}

export function teardownRunSequenceTest(): void {
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
}

export async function loadRunSequence() {
  const { runSequence } = await import("./run-sequence.js");
  return runSequence;
}

export async function loadRecentRunsPage() {
  const { recentRunsPage } = await import("./run-sequence.js");
  return recentRunsPage;
}
