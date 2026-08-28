import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "fs";
import { join } from "path";
import { conversationsDir } from "../config.js";
import {
  parseConversationMeta,
  parseDelegationEndRecord,
  parseDelegationEndRecordInput,
  parseDelegationRecord,
  parseDelegationRecordInput,
  parseTranscriptEvent,
  parseTranscriptEventInput,
  type ConversationChannel,
  type ConversationDetail,
  type ConversationMeta,
  type ConversationMetaPatch,
  type CreateConversationInput,
  type AgentRun,
  type DelegationEndRecord,
  type DelegationEndRecordInput,
  type DelegationRecord,
  type DelegationRecordInput,
  type DelegationRecordWithEnd,
  type TranscriptEvent,
  type TranscriptEventInput,
} from "../schemas.js";
import { channelForIssue } from "../kind.js";
import type { AgentSessions } from "./agent-sessions.js";
import { publishFrame, nextConversationSeq } from "./conversation-stream.js";
import { effectiveTranscriptSeq } from "./conversation-transcript-seq.js";
import { IssueError } from "./errors.js";
import { readIssueOrThrow } from "./issues.js";
import { uniqueSlug } from "./slug.js";

let writeChain: Promise<unknown> = Promise.resolve();

/** Serialize conversation writes on a single in-process promise chain. */
function serialize<T>(fn: () => T): Promise<T> {
  const run = writeChain.then(fn, fn);
  writeChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function dirOf(id: string): string {
  return join(conversationsDir, id);
}

function metaPathOf(id: string): string {
  return join(dirOf(id), "meta.json");
}

function transcriptPathOf(id: string): string {
  return join(dirOf(id), "transcript.jsonl");
}

function delegationsPathOf(id: string): string {
  return join(dirOf(id), "delegations.jsonl");
}

function scanIds(): string[] {
  if (!existsSync(conversationsDir)) return [];
  return readdirSync(conversationsDir).filter((entry) =>
    statSync(dirOf(entry)).isDirectory(),
  );
}

/** Conversation store ids on disk — same enumeration as implementing-project lock scans. */
export function listConversationIds(): string[] {
  return scanIds();
}

function validateAnchor(
  issueId: string | undefined,
  channel: ConversationChannel | undefined,
): { issueId: string; channel: ConversationChannel } | undefined {
  const hasIssueId = issueId !== undefined;
  const hasChannel = channel !== undefined;
  if (!hasIssueId && !hasChannel) return undefined;
  if (hasIssueId !== hasChannel) {
    throw new IssueError(
      "validation",
      hasIssueId
        ? "channel is required when issueId is set"
        : "issueId is required when channel is set",
    );
  }
  const issue = readIssueOrThrow(issueId!);
  const offered =
    issue.kind === "story"
      ? channelForIssue(issue, readIssueOrThrow(issue.partOf).kind)
      : channelForIssue(issue);
  if (offered === undefined) {
    throw new IssueError(
      "validation",
      `issue "${issueId}" does not offer a channel`,
    );
  }
  if (channel !== offered) {
    throw new IssueError(
      "validation",
      `channel "${channel}" is not offered by issue "${issueId}"`,
    );
  }
  return { issueId: issueId!, channel: channel! };
}

function readMetaRaw(id: string): ConversationMeta {
  const path = metaPathOf(id);
  if (!existsSync(path)) {
    throw new IssueError("not_found", `unknown conversation "${id}"`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new IssueError("validation", `invalid meta.json: ${detail}`);
  }
  const parsed = parseConversationMeta(raw);
  if (!parsed.ok) throw new IssueError("validation", parsed.message);
  if (parsed.meta.id !== id) {
    throw new IssueError(
      "validation",
      `meta.json id "${parsed.meta.id}" does not match directory name`,
    );
  }
  return parsed.meta;
}

function writeMeta(meta: ConversationMeta): void {
  writeFileSync(metaPathOf(meta.id), `${JSON.stringify(meta, null, 2)}\n`);
}

function readTranscriptLines(id: string): TranscriptEvent[] {
  const path = transcriptPathOf(id);
  if (!existsSync(path)) return [];
  const events: TranscriptEvent[] = [];
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
    events.push(
      parsed.event.seq === undefined
        ? { ...parsed.event, seq: effectiveTranscriptSeq(raw, lineSeq) }
        : parsed.event,
    );
  }
  return events;
}

/**
 * Allocate a conversation id and write its on-disk bootstrap (meta + empty
 * transcript/delegations), optionally persisting the first prompt line.
 * Caller must already hold the `serialize()` turn.
 */
function persistNewConversation(
  fields: Omit<ConversationMeta, "id" | "createdAt" | "updatedAt">,
  opts?: { initialPrompt?: string },
): ConversationMeta {
  const id = uniqueSlug(fields.title, scanIds());
  const now = new Date().toISOString();
  const meta: ConversationMeta = {
    ...fields,
    id,
    createdAt: now,
    updatedAt: now,
  };
  mkdirSync(dirOf(id), { recursive: true });
  writeMeta(meta);
  writeFileSync(transcriptPathOf(id), "");
  writeFileSync(delegationsPathOf(id), "");
  if (opts?.initialPrompt) {
    const stamped: TranscriptEvent = {
      type: "prompt",
      text: opts.initialPrompt,
      at: now,
    };
    appendFileSync(transcriptPathOf(id), `${JSON.stringify(stamped)}\n`);
  }
  return meta;
}

export function createConversation(
  input: CreateConversationInput,
): Promise<ConversationMeta> {
  return serialize(() => {
    const title = input.title.trim();
    if (!title) throw new IssueError("validation", "title is required");
    const projectId = input.projectId.trim();
    if (!projectId) throw new IssueError("validation", "projectId is required");
    const model = input.model.trim();
    if (!model) throw new IssueError("validation", "model is required");

    const anchor = validateAnchor(
      input.issueId?.trim() || undefined,
      input.channel,
    );

    const fields: Omit<ConversationMeta, "id" | "createdAt" | "updatedAt"> = {
      title,
      projectId,
      model,
    };
    if (input.agentId?.trim()) fields.agentId = input.agentId.trim();
    if (anchor) {
      fields.issueId = anchor.issueId;
      fields.channel = anchor.channel;
    }
    const initialPrompt = input.message?.trim() || undefined;
    return persistNewConversation(
      fields,
      initialPrompt ? { initialPrompt } : undefined,
    );
  });
}

export type CreateIssueChannelSessionInput = {
  issueId: string;
  channel: ConversationChannel;
  projectId: string;
  title: string;
  model: string;
  /** When set, the first prompt event is persisted in the same write turn. */
  message?: string;
};

export type CreateIssueChannelSessionResult = {
  meta: ConversationMeta;
  /** Trimmed first prompt when `message` was provided; caller starts the run. */
  initialPrompt?: string;
};

/**
 * Active-run lookup used by the Project implementing lock. Narrower than
 * `AgentSessions` so unit tests can stub just this probe.
 */
export type ActiveRunLookup = {
  getActiveRun(conversationId: string): unknown;
};

/**
 * Refuse creating an `implementing` session when another non-archived
 * implementing session in the same Project already has an active run.
 *
 * Rationale: every coordinator shares one git working tree today, so two
 * implementing loops would collide on branches and commits. The horizon is a
 * worktree per coordinator, at which point this lock can be lifted.
 */
function refuseIfImplementingProjectLocked(
  projectId: string,
  channel: ConversationChannel,
  sessions: ActiveRunLookup,
): void {
  if (channel !== "implementing") return;

  for (const id of scanIds()) {
    let existing: ConversationMeta;
    try {
      existing = readMetaRaw(id);
    } catch {
      continue;
    }
    if (
      existing.projectId !== projectId ||
      existing.channel !== "implementing" ||
      existing.archived ||
      !existing.issueId ||
      sessions.getActiveRun(id) === undefined
    ) {
      continue;
    }
    const holder = readIssueOrThrow(existing.issueId);
    throw new IssueError(
      "conflict",
      `project already has an active implementing session on issue "${existing.issueId}"`,
      {
        holderIssueId: existing.issueId,
        holderIssueTitle: holder.title,
      },
    );
  }
}

/**
 * Atomically validate eligibility, archive any active predecessor on the same
 * issue+channel, create the anchored session, and optionally persist the first
 * prompt event — one `serialize()` turn so concurrent POSTs cannot leave two
 * active sessions, and refused requests write nothing.
 */
export function createIssueChannelSession(
  input: CreateIssueChannelSessionInput,
  sessions: ActiveRunLookup,
): Promise<CreateIssueChannelSessionResult> {
  return serialize(() => {
    const issueId = input.issueId.trim();
    if (!issueId) throw new IssueError("validation", "issueId is required");
    const projectId = input.projectId.trim();
    if (!projectId) throw new IssueError("validation", "projectId is required");
    const title = input.title.trim();
    if (!title) throw new IssueError("validation", "title is required");
    const model = input.model.trim();
    if (!model) throw new IssueError("validation", "model is required");
    const initialPrompt = input.message?.trim() || undefined;

    // Refuse before any mutation.
    validateAnchor(issueId, input.channel);
    refuseIfImplementingProjectLocked(projectId, input.channel, sessions);

    const now = new Date().toISOString();
    for (const id of scanIds()) {
      let existing: ConversationMeta;
      try {
        existing = readMetaRaw(id);
      } catch {
        continue;
      }
      if (
        existing.issueId === issueId &&
        existing.channel === input.channel &&
        !existing.archived
      ) {
        writeMeta({ ...existing, archived: true, updatedAt: now });
      }
    }

    const meta = persistNewConversation(
      { title, projectId, model, issueId, channel: input.channel },
      initialPrompt ? { initialPrompt } : undefined,
    );
    return { meta, ...(initialPrompt ? { initialPrompt } : {}) };
  });
}

/** True when the conversation transcript has at least one persisted line. */
export function conversationHasTranscript(conversationId: string): boolean {
  const path = transcriptPathOf(conversationId);
  try {
    return statSync(path).size > 0;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw err;
  }
}

export function listConversations(): ConversationMeta[] {
  const metas: ConversationMeta[] = [];
  for (const id of scanIds()) {
    try {
      metas.push(readMetaRaw(id));
    } catch {
      // Skip unreadable / malformed conversation dirs.
    }
  }
  metas.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return metas;
}

export function readConversation(id: string): ConversationDetail {
  const meta = readMetaRaw(id);
  return { meta, transcript: readTranscriptLines(id) };
}

export function appendEvent(
  id: string,
  event: TranscriptEventInput,
): Promise<TranscriptEvent> {
  return serialize(() => {
    const meta = readMetaRaw(id);
    const parsed = parseTranscriptEventInput(event);
    if (!parsed.ok) throw new IssueError("validation", parsed.message);
    const preassigned =
      typeof (event as { seq?: unknown }).seq === "number"
        ? (event as { seq: number }).seq
        : undefined;
    const seq = nextConversationSeq(id, preassigned);
    const stamped: TranscriptEvent = {
      ...parsed.input,
      at: new Date().toISOString(),
      seq,
    };
    appendFileSync(transcriptPathOf(id), `${JSON.stringify(stamped)}\n`);
    writeMeta({ ...meta, updatedAt: new Date().toISOString() });
    if (stamped.type === "prompt") {
      publishFrame(id, { event: stamped, persist: false });
    }
    return stamped;
  });
}

type ParsedDelegationLine =
  | { kind: "start"; record: DelegationRecord }
  | { kind: "end"; record: DelegationEndRecord };

function readDelegationLines(id: string): ParsedDelegationLine[] {
  const path = delegationsPathOf(id);
  if (!existsSync(path)) return [];
  const lines: ParsedDelegationLine[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      continue;
    }
    const endParsed = parseDelegationEndRecord(raw);
    if (endParsed.ok) {
      lines.push({ kind: "end", record: endParsed.record });
      continue;
    }
    const startParsed = parseDelegationRecord(raw);
    if (startParsed.ok) {
      lines.push({ kind: "start", record: startParsed.record });
    }
  }
  return lines;
}

function agentRunAtDelegationStart(
  conversationId: string,
  record: DelegationRecord,
  priorDelegations: DelegationRecord[],
): AgentRun | undefined {
  if (!record.issueId || !record.parentCallId) return undefined;
  return {
    delegationId: record.delegationId,
    agentId: record.agentId,
    role: record.role,
    model: record.model,
    issueId: record.issueId,
    parentCallId: record.parentCallId,
    conversationId,
    startedAt: record.at,
    status: "running",
    isResume: priorDelegations.some((d) => d.agentId === record.agentId),
  };
}

/** Append a nested-agent delegation record (one JSON line). */
export function appendDelegation(
  id: string,
  record: DelegationRecordInput,
): Promise<DelegationRecord> {
  return serialize(() => {
    const meta = readMetaRaw(id);
    const parsed = parseDelegationRecordInput(record);
    if (!parsed.ok) throw new IssueError("validation", parsed.message);
    const priorDelegations = readDelegationLines(id);
    const priorStarts = priorDelegations.filter(
      (line): line is ParsedDelegationLine & { kind: "start" } =>
        line.kind === "start",
    );
    const stamped: DelegationRecord = {
      ...parsed.input,
      lifecycle: "tracked",
      at: new Date().toISOString(),
    };
    appendFileSync(delegationsPathOf(id), `${JSON.stringify(stamped)}\n`);
    writeMeta({ ...meta, updatedAt: new Date().toISOString() });
    const run = agentRunAtDelegationStart(
      id,
      stamped,
      priorStarts.map((line) => line.record),
    );
    if (run) {
      publishFrame(id, {
        event: { type: "delegation", run },
        persist: false,
      });
    }
    return stamped;
  });
}

/** Append a delegation end record (one JSON line). */
export function appendDelegationEnd(
  id: string,
  record: DelegationEndRecordInput,
): Promise<DelegationEndRecord> {
  return serialize(() => {
    const meta = readMetaRaw(id);
    const parsed = parseDelegationEndRecordInput(record);
    if (!parsed.ok) throw new IssueError("validation", parsed.message);
    const priorDelegations = readDelegationLines(id);
    const start = priorDelegations.find(
      (line): line is ParsedDelegationLine & { kind: "start" } =>
        line.kind === "start" &&
        line.record.delegationId === parsed.input.delegationId,
    );
    const stamped = {
      kind: "end" as const,
      ...parsed.input,
      endedAt: new Date().toISOString(),
    };
    appendFileSync(delegationsPathOf(id), `${JSON.stringify(stamped)}\n`);
    writeMeta({ ...meta, updatedAt: new Date().toISOString() });
    if (start?.record.issueId && start.record.parentCallId) {
      publishFrame(id, {
        event: {
          type: "delegation_end",
          delegationId: stamped.delegationId,
          parentCallId: start.record.parentCallId,
          status: stamped.status,
          endedAt: stamped.endedAt,
          ...(stamped.failureClass !== undefined
            ? { failureClass: stamped.failureClass }
            : {}),
        },
        persist: false,
      });
    }
    return stamped;
  });
}

/** Load persisted nested-agent ids for a conversation (append order). */
export function readDelegations(id: string): DelegationRecordWithEnd[] {
  readMetaRaw(id);
  const lines = readDelegationLines(id);
  const records: DelegationRecordWithEnd[] = [];
  const byId = new Map<string, DelegationRecordWithEnd>();
  for (const line of lines) {
    if (line.kind === "end") {
      const start = byId.get(line.record.delegationId);
      if (!start) continue;
      start.end = {
        status: line.record.status,
        endedAt: line.record.endedAt,
        ...(line.record.failureClass !== undefined
          ? { failureClass: line.record.failureClass }
          : {}),
      };
      continue;
    }
    const withEnd: DelegationRecordWithEnd = { ...line.record };
    records.push(withEnd);
    byId.set(line.record.delegationId, withEnd);
  }
  return records;
}

/** True when `meta.json` exists for the conversation id. */
export function conversationExists(id: string): boolean {
  return existsSync(metaPathOf(id));
}

/** Write pending message meta and publish the matching live-only frame. */
export async function setPendingMessage(
  id: string,
  text: string | null,
): Promise<ConversationMeta> {
  const meta = await updateMeta(id, {
    pendingMessage:
      text === null ? null : { text, at: new Date().toISOString() },
  });
  publishFrame(id, {
    event: { type: "pending", text },
    persist: false,
  });
  return meta;
}

/**
 * Start a run from a user prompt (shared by /messages and channel-session create).
 * Pass `persistPrompt: false` when the prompt event was already written (e.g. inside
 * `createIssueChannelSession`'s atomic turn).
 */
export async function startConversationPrompt(
  conversationId: string,
  prompt: string,
  model: string | undefined,
  sessions: AgentSessions,
  opts?: { persistPrompt?: boolean },
): Promise<{ ok: true; runId: string } | { ok: false; message: string }> {
  const persistPrompt = opts?.persistPrompt !== false;
  const { meta } = readConversation(conversationId);
  if (meta.pendingMessage) {
    await setPendingMessage(conversationId, null);
  }

  if (persistPrompt) {
    await appendEvent(conversationId, { type: "prompt", text: prompt });
  }

  const result = await sessions.sendPrompt(conversationId, {
    prompt,
    model,
  });
  if (!result.ok) {
    const message = result.error.message;
    const event = { type: "error" as const, message };
    publishFrame(conversationId, { event, persist: true });
    await appendEvent(conversationId, event);
    return { ok: false, message };
  }

  return { ok: true, runId: result.run.id };
}

export function updateMeta(
  id: string,
  patch: ConversationMetaPatch,
): Promise<ConversationMeta> {
  return serialize(() => {
    const meta = readMetaRaw(id);
    const next: ConversationMeta = { ...meta };

    if (patch.title !== undefined) {
      const title = patch.title.trim();
      if (!title) throw new IssueError("validation", "title is required");
      next.title = title;
    }
    if (patch.model !== undefined) {
      const model = patch.model.trim();
      if (!model) throw new IssueError("validation", "model is required");
      next.model = model;
    }
    if (patch.agentId !== undefined) {
      const agentId = patch.agentId.trim();
      if (!agentId) throw new IssueError("validation", "agentId is required");
      next.agentId = agentId;
    }
    if (patch.pendingMessage !== undefined) {
      if (patch.pendingMessage === null) {
        delete next.pendingMessage;
      } else {
        next.pendingMessage = patch.pendingMessage;
      }
    }
    if (patch.archived !== undefined) {
      next.archived = patch.archived;
    }

    next.updatedAt = new Date().toISOString();
    writeMeta(next);
    return next;
  });
}

export function deleteConversation(id: string): Promise<void> {
  return serialize(() => {
    if (!existsSync(dirOf(id))) {
      throw new IssueError("not_found", `unknown conversation "${id}"`);
    }
    rmSync(dirOf(id), { recursive: true, force: true });
  });
}
