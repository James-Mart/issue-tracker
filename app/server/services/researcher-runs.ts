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

function lastErrorMessage(transcript: TranscriptEvent[]): string | undefined {
  for (let i = transcript.length - 1; i >= 0; i -= 1) {
    const event = transcript[i]!;
    if (event.type === "error") return event.message;
  }
  return undefined;
}

/** Conversation id when this thread is an open question with a researcher. */
export function activeResearcherConversationId(
  thread: Pick<ThreadView, "kind" | "state" | "researcherConversationId">,
): string | undefined {
  if (thread.kind !== "question" || thread.state !== "open") return undefined;
  return thread.researcherConversationId;
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

function researcherRunFor(
  thread: ThreadView,
  messages: Comment[],
): ResearcherRun | undefined {
  const conversationId = activeResearcherConversationId(thread);
  if (!conversationId) return undefined;
  if (!conversationExists(conversationId)) {
    return { status: "failed", error: RESEARCHER_GONE };
  }
  if (isRunLive(conversationId)) return { status: "running" };
  const { transcript } = readConversation(conversationId);
  const askedAt = latestAskAt(thread, messages);
  const answered = messages.some(
    (message) =>
      message.replyTo === thread.rootId &&
      message.role !== "human" &&
      message.at > askedAt,
  );
  if (answered) return undefined;
  return {
    status: "failed",
    error: lastErrorMessage(transcript) ?? RESEARCHER_NO_REPLY,
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

/** Every researcher conversation recorded on the Story, oldest first. */
export function researcherConversationIds(storyId: string): string[] {
  return researcherSessionEvents(readCommentLog(storyId).events).flatMap(
    (event) => [event.conversationId!],
  );
}

function researcherAgentRun(
  { meta, transcript }: ConversationDetail,
  issueId: string,
): AgentRun {
  const running = isRunLive(meta.id);
  const failed = !running && lastErrorMessage(transcript) !== undefined;
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
  };
}

/** One agent run per researcher conversation started on the Story. */
export function researcherRunsForIssue(issueId: string): AgentRun[] {
  return researcherConversationIds(issueId)
    .filter(conversationExists)
    .map((id) => researcherAgentRun(readConversation(id), issueId));
}

/** Conversation id behind a researcher agent run's delegation id, if it is one. */
export function conversationIdFromResearcherDelegation(
  delegationId: string,
): string | undefined {
  return delegationId.startsWith(DELEGATION_PREFIX)
    ? delegationId.slice(DELEGATION_PREFIX.length)
    : undefined;
}
