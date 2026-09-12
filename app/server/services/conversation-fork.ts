import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  JSONL_LOCAL_AGENT_STORE_FILES,
  type LocalAgentRunDocument,
  type LocalAgentRunStatus,
} from "@cursor/sdk";
import type { TranscriptEvent } from "../schemas/conversation.js";
import { conversationsDir } from "../config.js";
import {
  effectiveTranscriptSeq,
  parseTranscriptEvent,
  transcriptPathOf,
} from "./conversation-transcript-seq.js";

export type ResolvedForkPoint = {
  runId: string;
  rootBlobId: string;
  turnNumber: number;
};

const TERMINAL_RUN_STATUSES = new Set<LocalAgentRunStatus>([
  "finished",
  "error",
  "cancelled",
  "expired",
]);

function agentStateDir(conversationId: string): string {
  return join(conversationsDir, conversationId, "agent-state");
}

function runsPath(conversationId: string): string {
  return join(agentStateDir(conversationId), JSONL_LOCAL_AGENT_STORE_FILES.runs);
}

function readTranscriptEventAt(
  conversationId: string,
  seq: number,
): TranscriptEvent {
  const path = transcriptPathOf(conversationId);
  if (!existsSync(path)) {
    throw new Error(
      `fork point seq ${seq}: conversation "${conversationId}" has no transcript`,
    );
  }

  let lineSeq = 0;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue;
    lineSeq += 1;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      continue;
    }
    const parsed = parseTranscriptEvent(raw);
    if (!parsed.ok) continue;
    const effectiveSeq =
      parsed.event.seq ?? effectiveTranscriptSeq(raw, lineSeq);
    if (effectiveSeq !== seq) continue;
    return parsed.event.seq === undefined
      ? { ...parsed.event, seq: effectiveSeq }
      : parsed.event;
  }

  throw new Error(
    `fork point seq ${seq}: no transcript event on conversation "${conversationId}"`,
  );
}

function readRuns(conversationId: string): LocalAgentRunDocument[] {
  const path = runsPath(conversationId);
  if (!existsSync(path)) return [];

  const runs: LocalAgentRunDocument[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue;
    runs.push(JSON.parse(line) as LocalAgentRunDocument);
  }
  return runs;
}

function isTerminalRun(run: LocalAgentRunDocument): boolean {
  return TERMINAL_RUN_STATUSES.has(run.status);
}

function runStartedAtMs(run: LocalAgentRunDocument): number | null {
  if (run.startedAt == null) return null;
  return run.startedAt;
}

function compareRuns(
  a: LocalAgentRunDocument,
  b: LocalAgentRunDocument,
): number {
  const aStarted = runStartedAtMs(a)!;
  const bStarted = runStartedAtMs(b)!;
  if (aStarted !== bStarted) return aStarted - bStarted;
  if (a.updatedAt !== b.updatedAt) return a.updatedAt - b.updatedAt;
  return a.runId.localeCompare(b.runId);
}

function selectRunForEventAt(
  runs: readonly LocalAgentRunDocument[],
  eventAtMs: number,
): LocalAgentRunDocument | null {
  let selected: LocalAgentRunDocument | null = null;

  for (const run of runs) {
    const startedAt = runStartedAtMs(run);
    if (startedAt === null || startedAt > eventAtMs) continue;
    if (!selected || compareRuns(run, selected) > 0) {
      selected = run;
    }
  }

  return selected;
}

/** Resolve a transcript position to its enclosing completed run checkpoint. */
export function resolveForkPoint(
  conversationId: string,
  seq: number,
): ResolvedForkPoint {
  const event = readTranscriptEventAt(conversationId, seq);
  const eventAtMs = Date.parse(event.at);
  if (Number.isNaN(eventAtMs)) {
    throw new Error(
      `fork point seq ${seq}: transcript event has invalid at "${event.at}"`,
    );
  }

  const run = selectRunForEventAt(readRuns(conversationId), eventAtMs);
  if (!run) {
    throw new Error(
      `fork point seq ${seq}: no run started at or before transcript event time`,
    );
  }

  if (!isTerminalRun(run)) {
    throw new Error(
      `fork point seq ${seq}: run "${run.runId}" is still in flight (${run.status})`,
    );
  }

  const rootBlobId = run.latestCheckpointRef?.rootBlobId;
  if (!rootBlobId) {
    throw new Error(
      `fork point seq ${seq}: run "${run.runId}" has no latest checkpoint`,
    );
  }

  return {
    runId: run.runId,
    rootBlobId,
    turnNumber: run.turnNumber,
  };
}
