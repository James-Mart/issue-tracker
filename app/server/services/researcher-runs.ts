import { existsSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { z } from "zod";
import { conversationsDir } from "../config.js";
import type {
  AgentRun,
  Comment,
  CommentsResponse,
  CommentThreadView,
  ConversationDetail,
  ConversationMeta,
  ResearcherRun,
  ThreadEvent,
  ThreadView,
  TranscriptEvent,
} from "../schemas.js";
import type { AgentRunResult } from "./agent-sdk.js";
import {
  appendErrorEvent,
  conversationExists,
  readConversation,
  readConversationMeta,
} from "./conversations.js";
import { deriveAnchoredOutdated } from "./anchor-outdated.js";
import { findThreadRoot } from "./thread-events.js";
import { readCommentLog } from "./comment-log.js";
import { readIssueOrThrow, taskStatusesForStory } from "./issues.js";
import { isRunLive } from "./run-live.js";
import { commentsFromLog } from "./thread-state.js";

export const REVIEW_QUESTION_ROLE = "issue-tracker-review-question";

const DELEGATION_PREFIX = "review-question:";

// Reasons read as the tail of "Researcher couldn't get an answer — …".
export const RESEARCHER_GONE = "its conversation no longer exists.";
export const RESEARCHER_NO_REPLY = "the run ended without a reply.";

const RUN_STARTED = "run-started.json";
const RUN_END = "run-end.json";

const runStampSchema = z
  .object({
    startedAt: z.string().refine((value) => !Number.isNaN(Date.parse(value)), {
      message: "startedAt must be an ISO timestamp",
    }),
  })
  .strict();

function markerPath(conversationId: string, name: string): string {
  return join(conversationsDir, conversationId, name);
}

function readStamp(conversationId: string, name: string): string | undefined {
  const path = markerPath(conversationId, name);
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new Error(
      `unreadable ${name} at ${path}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `unparseable ${name} at ${path}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const result = runStampSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`unparseable ${name} at ${path}: ${result.error.message}`);
  }
  return result.data.startedAt;
}

/** When this researcher run started, from its stamps or the conversation's creation. */
function researcherStartedAt(conversationId: string): string {
  return (
    readStamp(conversationId, RUN_STARTED) ??
    readStamp(conversationId, RUN_END) ??
    readConversationMeta(conversationId).createdAt
  );
}

export function researcherRunEndRecorded(conversationId: string): boolean {
  return existsSync(markerPath(conversationId, RUN_END));
}

/** A researcher run became live. Drops the previous run's end marker. */
export function noteResearcherRunStarted(
  conversationId: string,
  startedAt: string,
): void {
  writeFileSync(
    markerPath(conversationId, RUN_STARTED),
    `${JSON.stringify({ startedAt })}\n`,
  );
  rmSync(markerPath(conversationId, RUN_END), { force: true });
}

/**
 * The transcript has fully flushed and this run is not continuing.
 * Failure is read from this marker, not from the live marker merely being gone.
 */
export function recordResearcherRunEnd(
  conversationId: string,
  startedAt?: string,
): void {
  const at = startedAt ?? researcherStartedAt(conversationId);
  writeFileSync(
    markerPath(conversationId, RUN_END),
    `${JSON.stringify({ startedAt: at })}\n`,
  );
}

/**
 * Launches that run after the comment response, keyed by thread root id.
 * The overlay is `running` until it settles. One that throws before it records
 * a conversation stays `failed` until the next launch on that thread. Process
 * memory only: a restart forgets a launch that never recorded a conversation.
 */
const researcherLaunches = new Map<string, ResearcherRun>();

/**
 * Show `threadId` as running while `launch` runs. The launch is started
 * synchronously, so a read right after this call already sees it.
 */
export async function trackResearcherLaunch(
  threadId: string,
  launch: () => Promise<void>,
): Promise<void> {
  // A later launch on the same thread owns the entry once it starts.
  const launchRun: ResearcherRun = {
    status: "running",
    startedAt: new Date().toISOString(),
  };
  researcherLaunches.set(threadId, launchRun);
  try {
    await launch();
    if (researcherLaunches.get(threadId) === launchRun) {
      researcherLaunches.delete(threadId);
    }
  } catch (err) {
    if (researcherLaunches.get(threadId) === launchRun) {
      researcherLaunches.set(threadId, {
        status: "failed",
        startedAt: launchRun.startedAt,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    throw err;
  }
}

/** Latest transcript error, optionally only those at or after `since`. */
function latestTranscriptError(
  transcript: TranscriptEvent[],
  since?: string,
): string | undefined {
  for (let i = transcript.length - 1; i >= 0; i -= 1) {
    const event = transcript[i]!;
    if (event.type !== "error") continue;
    if (since !== undefined && event.at < since) continue;
    return event.message;
  }
  return undefined;
}

function isOpenQuestion(thread: Pick<ThreadView, "kind" | "state">): boolean {
  return thread.kind === "question" && thread.state === "open";
}

/** Conversation id when this thread is an open question with a researcher. */
export function activeResearcherConversationId(
  thread: Pick<ThreadView, "kind" | "state" | "researcherConversationId">,
): string | undefined {
  return isOpenQuestion(thread) ? thread.researcherConversationId : undefined;
}

/**
 * A conversation a `researcher-session` event names, or one started for the
 * researcher role. The role covers a run that ends before its event lands.
 */
export function isQuestionResearcherConversation(
  meta: Pick<ConversationMeta, "id" | "issueId" | "channel" | "role">,
): boolean {
  if (meta.role === REVIEW_QUESTION_ROLE) return true;
  if (meta.channel !== "review" || meta.issueId === undefined) return false;
  return researcherConversationIds(meta.issueId).includes(meta.id);
}

/** Record why a researcher run ended without finishing, for the thread's failure notice. */
export async function recordResearcherRunFailure(
  conversationId: string,
  result: AgentRunResult,
): Promise<void> {
  if (result.status === "finished") return;
  await appendErrorEvent(
    conversationId,
    result.error?.message || `the run was ${result.status}.`,
  );
}

/** Time of the question, or of the last human reply in append order. */
function latestAskAt(thread: ThreadView, messages: Comment[]): string {
  const root = findThreadRoot(messages, thread.rootId);
  let at = root.at;
  for (const message of messages) {
    if (message.replyTo === thread.rootId && message.role === "human") {
      at = message.at;
    }
  }
  return at;
}

function qualifyingReply(
  thread: ThreadView,
  messages: Comment[],
): boolean {
  const askedAt = latestAskAt(thread, messages);
  return messages.some(
    (message) =>
      message.replyTo === thread.rootId &&
      message.role !== "human" &&
      message.at > askedAt,
  );
}

function researcherRunFor(
  thread: ThreadView,
  messages: Comment[],
): ResearcherRun | undefined {
  if (!isOpenQuestion(thread)) return undefined;
  const launch = researcherLaunches.get(thread.rootId);
  if (launch) return launch;
  const conversationId = thread.researcherConversationId;
  if (!conversationId) return undefined;
  if (qualifyingReply(thread, messages)) return undefined;
  const askedAt = latestAskAt(thread, messages);
  if (!conversationExists(conversationId)) {
    return { status: "failed", startedAt: askedAt, error: RESEARCHER_GONE };
  }
  const startedAt = researcherStartedAt(conversationId);
  if (isRunLive(conversationId)) return { status: "running", startedAt };
  if (!researcherRunEndRecorded(conversationId)) {
    return { status: "finishing", startedAt };
  }
  const { transcript } = readConversation(conversationId);
  return {
    status: "failed",
    startedAt,
    error: latestTranscriptError(transcript, startedAt) ?? RESEARCHER_NO_REPLY,
  };
}

function researcherSessionEvents(events: ThreadEvent[]): ThreadEvent[] {
  return events.filter((event) => event.event === "researcher-session");
}

/**
 * Mark the first non-human reply of each recovered researcher session.
 * The note stays on that reply until the next `researcher-session` event.
 * `events` are the same log parse that produced `response`.
 */
function withNewSessionNotes(
  response: CommentsResponse,
  events: ThreadEvent[],
): CommentsResponse {
  const sessions = researcherSessionEvents(events);
  if (!sessions.some((event) => event.recovered)) return response;

  const ids = new Set<string>();
  for (const [index, event] of sessions.entries()) {
    if (!event.recovered) continue;
    const next = sessions
      .slice(index + 1)
      .find((later) => later.threadId === event.threadId);
    const reply = response.messages.find(
      (message) =>
        message.replyTo === event.threadId &&
        message.role !== "human" &&
        message.at >= event.at &&
        (next === undefined || message.at < next.at),
    );
    if (reply) ids.add(reply.id);
  }
  if (ids.size === 0) return response;
  return {
    ...response,
    messages: response.messages.map((message) =>
      ids.has(message.id) ? { ...message, newSession: true } : message,
    ),
  };
}

/** Decorate open question threads with their researcher's live or failed state. */
function withResearcherRuns(response: CommentsResponse): CommentsResponse {
  return {
    ...response,
    threads: response.threads.map((thread): CommentThreadView => {
      const researcherRun = researcherRunFor(thread, response.messages);
      return researcherRun ? { ...thread, researcherRun } : thread;
    }),
  };
}

/** Comments read used by the HTTP route and `issue view --comments`. */
export async function enrichCommentsForRead(
  issueId: string,
): Promise<CommentsResponse> {
  const issue = readIssueOrThrow(issueId);
  const taskStatusById =
    issue.kind === "story" ? taskStatusesForStory(issueId) : new Map();
  const log = readCommentLog(issueId);
  const parsed = commentsFromLog(issueId, log, taskStatusById);
  const response: CommentsResponse = {
    ...parsed,
    messages: await deriveAnchoredOutdated(issueId, parsed.messages),
  };
  return withNewSessionNotes(withResearcherRuns(response), log.events);
}

/** The researcher state for one thread, as the comments route would serve it. */
export function researcherRunForThread(
  response: CommentsResponse,
  threadId: string,
): ResearcherRun | undefined {
  const thread = response.threads.find((view) => view.rootId === threadId);
  return thread ? researcherRunFor(thread, response.messages) : undefined;
}

/** Researcher sessions recorded on the Story, oldest first, one per conversation. */
function researcherSessions(
  issueId: string,
): { conversationId: string; threadId: string }[] {
  const seen = new Set<string>();
  const sessions: { conversationId: string; threadId: string }[] = [];
  for (const event of researcherSessionEvents(readCommentLog(issueId).events)) {
    const conversationId = event.conversationId;
    if (!conversationId || seen.has(conversationId)) continue;
    seen.add(conversationId);
    sessions.push({ conversationId, threadId: event.threadId });
  }
  return sessions;
}

/** Every researcher conversation recorded on the Story, oldest first. */
export function researcherConversationIds(storyId: string): string[] {
  return researcherSessions(storyId).map((session) => session.conversationId);
}

function researcherAgentRun(
  { meta, transcript }: ConversationDetail,
  issueId: string,
  threadId: string,
): AgentRun {
  const running = isRunLive(meta.id);
  const failed = !running && latestTranscriptError(transcript) !== undefined;
  return {
    delegationId: `${DELEGATION_PREFIX}${meta.id}`,
    agentId: meta.agentId ?? meta.id,
    role: REVIEW_QUESTION_ROLE,
    model: meta.model,
    issueId,
    parentCallId: meta.id,
    conversationId: meta.id,
    startedAt: meta.createdAt,
    status: running ? "running" : failed ? "error" : "completed",
    ...(running ? {} : { endedAt: meta.updatedAt }),
    isResume: false,
    threadId,
  };
}

/** One agent run per researcher conversation started on the Story. */
export function researcherRunsForIssue(issueId: string): AgentRun[] {
  return researcherSessions(issueId).flatMap((session) => {
    if (!conversationExists(session.conversationId)) return [];
    return [
      researcherAgentRun(
        readConversation(session.conversationId),
        issueId,
        session.threadId,
      ),
    ];
  });
}

/** Conversation id behind a researcher agent run's delegation id, if it is one. */
export function conversationIdFromResearcherDelegation(
  delegationId: string,
): string | undefined {
  return delegationId.startsWith(DELEGATION_PREFIX)
    ? delegationId.slice(DELEGATION_PREFIX.length)
    : undefined;
}
