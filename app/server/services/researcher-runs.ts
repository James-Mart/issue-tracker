import type {
  AgentRun,
  Comment,
  CommentsResponse,
  CommentThreadView,
  ConversationDetail,
  ConversationMeta,
  ResearcherRun,
  ThreadView,
  TranscriptEvent,
} from "../schemas.js";
import type { AgentRunResult } from "./agent-sdk.js";
import {
  appendErrorEvent,
  conversationExists,
  readConversation,
} from "./conversations.js";
import { readCommentLog } from "./comment-log.js";
import { isRunLive } from "./run-live.js";

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

/** Review-channel conversations are question researchers. */
export function isQuestionResearcherConversation(
  meta: Pick<ConversationMeta, "channel">,
): boolean {
  return meta.channel === "review";
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

function researcherRunFor(
  thread: ThreadView,
  messages: Comment[],
): ResearcherRun | undefined {
  const conversationId = thread.researcherConversationId;
  if (thread.kind !== "question" || thread.state !== "open" || !conversationId) {
    return undefined;
  }
  if (!conversationExists(conversationId)) {
    return { status: "failed", error: RESEARCHER_GONE };
  }
  if (isRunLive(conversationId)) return { status: "running" };
  const { meta, transcript } = readConversation(conversationId);
  const answered = messages.some(
    (message) =>
      message.replyTo === thread.rootId &&
      message.role !== "human" &&
      message.at >= meta.createdAt,
  );
  if (answered) return undefined;
  return {
    status: "failed",
    error: lastErrorMessage(transcript) ?? RESEARCHER_NO_REPLY,
  };
}

/** Decorate open question threads with their researcher's live or failed state. */
export function withResearcherRuns(response: CommentsResponse): CommentsResponse {
  return {
    ...response,
    threads: response.threads.map((thread): CommentThreadView => {
      const researcherRun = researcherRunFor(thread, response.messages);
      return researcherRun ? { ...thread, researcherRun } : thread;
    }),
  };
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
  return readCommentLog(storyId).events.flatMap((event) =>
    event.event === "researcher-session" ? [event.conversationId!] : [],
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
