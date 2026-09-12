import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import {
  JSONL_LOCAL_AGENT_STORE_FILES,
  type LocalAgentRunDocument,
  type LocalAgentRunStatus,
} from "@cursor/sdk";
import {
  parseDelegationEndRecord,
  parseDelegationRecord,
  type TranscriptEvent,
} from "../schemas/conversation.js";
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

export type CopyAgentStateInput = {
  sourceDir: string;
  targetDir: string;
  newAgentId: string;
  keepRunId: string;
};

export type CopyInheritedHistoryInput = {
  sourceId: string;
  targetId: string;
  forkedAtSeq: number;
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

function conversationDir(conversationId: string): string {
  return join(conversationsDir, conversationId);
}

function delegationsPathOf(conversationId: string): string {
  return join(conversationDir(conversationId), "delegations.jsonl");
}

function attachmentsDirOf(conversationId: string): string {
  return join(conversationDir(conversationId), "attachments");
}

function nestedAgentStateDir(
  conversationId: string,
  agentId: string,
): string {
  return join(agentStateDir(conversationId), "nested", agentId);
}

function timestampMs(at: string, context: string): number {
  const ms = Date.parse(at);
  if (Number.isNaN(ms)) {
    throw new Error(`${context}: invalid timestamp "${at}"`);
  }
  return ms;
}

function delegationLineTimestamp(raw: Record<string, unknown>): number | null {
  const endParsed = parseDelegationEndRecord(raw);
  if (endParsed.ok) {
    return timestampMs(endParsed.record.endedAt, "delegation end record");
  }
  const startParsed = parseDelegationRecord(raw);
  if (startParsed.ok) {
    return timestampMs(startParsed.record.at, "delegation record");
  }
  return null;
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

function readNdjsonRecords(filePath: string): Record<string, unknown>[] {
  if (!existsSync(filePath)) return [];

  const content = readFileSync(filePath, "utf8");
  if (!content) return [];

  const lines = content.split("\n");
  const records: Record<string, unknown>[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.trim()) continue;
    try {
      records.push(JSON.parse(line) as Record<string, unknown>);
    } catch {
      if (i === lines.length - 1) continue;
      throw new Error(`Invalid NDJSON in ${filePath} at line ${i + 1}`);
    }
  }

  return records;
}

function writeNdjsonRecords(
  filePath: string,
  records: readonly Record<string, unknown>[],
): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const body =
    records.length === 0
      ? ""
      : `${records.map((row) => JSON.stringify(row)).join("\n")}\n`;
  writeFileSync(filePath, body, "utf8");
}

function compareRunsForTrim(
  a: Pick<LocalAgentRunDocument, "turnNumber" | "runId">,
  b: Pick<LocalAgentRunDocument, "turnNumber" | "runId">,
): number {
  if (a.turnNumber !== b.turnNumber) return a.turnNumber - b.turnNumber;
  return a.runId.localeCompare(b.runId);
}

function rewriteAgentId(
  row: Record<string, unknown>,
  newAgentId: string,
): Record<string, unknown> {
  return { ...row, agentId: newAgentId };
}

/** Copy agent-state NDJSON into a new directory under a fresh agent id. */
export function copyAgentState(input: CopyAgentStateInput): void {
  const { sourceDir, targetDir, newAgentId, keepRunId } = input;
  mkdirSync(targetDir, { recursive: true });

  const runsPath = join(sourceDir, JSONL_LOCAL_AGENT_STORE_FILES.runs);
  const runRecords = readNdjsonRecords(runsPath) as LocalAgentRunDocument[];

  const keptRun = runRecords.find((run) => run.runId === keepRunId);
  if (!keptRun) {
    throw new Error(
      `copyAgentState: no run with id "${keepRunId}" in ${runsPath}`,
    );
  }

  const keptRuns = runRecords.filter(
    (run) => compareRunsForTrim(run, keptRun) <= 0,
  );
  const keptRunIds = new Set(keptRuns.map((run) => run.runId));

  const copiedRuns = keptRuns.map((run) =>
    rewriteAgentId(run as unknown as Record<string, unknown>, newAgentId),
  );

  const copiedAgents = readNdjsonRecords(
    join(sourceDir, JSONL_LOCAL_AGENT_STORE_FILES.agents),
  ).map((row) => ({
    ...rewriteAgentId(row, newAgentId),
    latestCheckpoint: keptRun.latestCheckpointRef ?? null,
    activeRunId: null,
    status: "idle",
  }));

  const copiedCheckpoints = readNdjsonRecords(
    join(sourceDir, JSONL_LOCAL_AGENT_STORE_FILES.checkpoints),
  ).map((row) => rewriteAgentId(row, newAgentId));

  const copiedEvents = readNdjsonRecords(
    join(sourceDir, JSONL_LOCAL_AGENT_STORE_FILES.runEvents),
  ).filter((row) => {
    const runId = row.runId;
    return typeof runId === "string" && keptRunIds.has(runId);
  });

  writeNdjsonRecords(
    join(targetDir, JSONL_LOCAL_AGENT_STORE_FILES.agents),
    copiedAgents,
  );
  writeNdjsonRecords(
    join(targetDir, JSONL_LOCAL_AGENT_STORE_FILES.runs),
    copiedRuns,
  );
  writeNdjsonRecords(
    join(targetDir, JSONL_LOCAL_AGENT_STORE_FILES.checkpoints),
    copiedCheckpoints,
  );
  writeNdjsonRecords(
    join(targetDir, JSONL_LOCAL_AGENT_STORE_FILES.runEvents),
    copiedEvents,
  );
}

function writeJsonlLines(filePath: string, lines: readonly string[]): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(
    filePath,
    lines.length === 0 ? "" : `${lines.join("\n")}\n`,
    "utf8",
  );
}

function copyTranscriptThroughFork(
  sourceId: string,
  targetId: string,
  forkedAtSeq: number,
): Set<string> {
  const sourcePath = transcriptPathOf(sourceId);
  if (!existsSync(sourcePath)) {
    throw new Error(
      `copyInheritedHistory: conversation "${sourceId}" has no transcript`,
    );
  }

  const keptLines: string[] = [];
  const attachmentNames = new Set<string>();
  let lineSeq = 0;

  for (const line of readFileSync(sourcePath, "utf8").split("\n")) {
    if (!line.trim()) continue;
    lineSeq += 1;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      continue;
    }
    const effectiveSeq =
      typeof raw === "object" &&
      raw !== null &&
      typeof (raw as { seq?: unknown }).seq === "number"
        ? (raw as { seq: number }).seq
        : effectiveTranscriptSeq(raw, lineSeq);
    if (effectiveSeq > forkedAtSeq) continue;

    keptLines.push(line);
    const parsed = parseTranscriptEvent(raw);
    if (
      parsed.ok &&
      parsed.event.type === "prompt" &&
      parsed.event.attachments
    ) {
      for (const name of parsed.event.attachments) {
        attachmentNames.add(name);
      }
    }
  }

  writeJsonlLines(transcriptPathOf(targetId), keptLines);
  return attachmentNames;
}

function copyDelegationsThroughFork(
  sourceId: string,
  targetId: string,
  forkAtMs: number,
): Set<string> {
  const sourcePath = delegationsPathOf(sourceId);
  if (!existsSync(sourcePath)) {
    writeJsonlLines(delegationsPathOf(targetId), []);
    return new Set();
  }

  const keptLines: string[] = [];
  const keptAgentIds = new Set<string>();

  for (const line of readFileSync(sourcePath, "utf8").split("\n")) {
    if (!line.trim()) continue;
    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    const atMs = delegationLineTimestamp(raw);
    if (atMs === null || atMs > forkAtMs) continue;

    keptLines.push(line);
    const startParsed = parseDelegationRecord(raw);
    if (startParsed.ok) {
      keptAgentIds.add(startParsed.record.agentId);
    }
  }

  writeJsonlLines(delegationsPathOf(targetId), keptLines);
  return keptAgentIds;
}

function copyNestedDelegationStores(
  sourceId: string,
  targetId: string,
  agentIds: ReadonlySet<string>,
): void {
  for (const agentId of agentIds) {
    const sourceDir = nestedAgentStateDir(sourceId, agentId);
    if (!existsSync(sourceDir)) {
      throw new Error(
        `copyInheritedHistory: missing nested store for delegation "${agentId}" on "${sourceId}"`,
      );
    }
    const targetDir = nestedAgentStateDir(targetId, agentId);
    mkdirSync(dirname(targetDir), { recursive: true });
    cpSync(sourceDir, targetDir, { recursive: true });
  }
}

function copyPromptAttachments(
  sourceId: string,
  targetId: string,
  names: ReadonlySet<string>,
): void {
  if (names.size === 0) return;

  const sourceAttachmentsDir = attachmentsDirOf(sourceId);
  const targetAttachmentsDir = attachmentsDirOf(targetId);
  mkdirSync(targetAttachmentsDir, { recursive: true });

  for (const name of names) {
    const sourcePath = join(sourceAttachmentsDir, name);
    if (!existsSync(sourcePath)) {
      throw new Error(
        `copyInheritedHistory: attachment "${name}" missing on "${sourceId}"`,
      );
    }
    cpSync(sourcePath, join(targetAttachmentsDir, name));
  }
}

/** Copy transcript, delegations, nested stores, and prompt attachments through a fork point. */
export function copyInheritedHistory(input: CopyInheritedHistoryInput): void {
  const { sourceId, targetId, forkedAtSeq } = input;
  const forkEvent = readTranscriptEventAt(sourceId, forkedAtSeq);
  const forkAtMs = timestampMs(
    forkEvent.at,
    `fork point seq ${forkedAtSeq}`,
  );

  const attachmentNames = copyTranscriptThroughFork(
    sourceId,
    targetId,
    forkedAtSeq,
  );
  const keptAgentIds = copyDelegationsThroughFork(
    sourceId,
    targetId,
    forkAtMs,
  );
  copyNestedDelegationStores(sourceId, targetId, keptAgentIds);
  copyPromptAttachments(sourceId, targetId, attachmentNames);
}
