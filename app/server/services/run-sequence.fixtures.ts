import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { vi } from "vitest";
import type {
  DelegationRecord,
  DelegationRecordWithEnd,
  TranscriptEvent,
} from "../schemas.js";

export const AT = "2026-07-09T14:00:00.000Z";
export const AT_EARLY = "2026-07-09T13:00:00.000Z";
export const AT_CHILD = "2026-07-09T14:05:00.000Z";
export const AT_END = "2026-07-09T14:00:05.000Z";
export const AT_LATE = "2026-07-09T16:00:00.000Z";

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

export function prompt(text: string, at: string, seq: number): TranscriptEvent {
  return { type: "prompt", text, at, seq };
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
