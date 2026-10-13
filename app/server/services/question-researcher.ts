import { anchorLineRange } from "@/features/issues/lib/comment-anchor-snippet";
import {
  isLineAnchor,
  type Comment,
  type CommentsResponse,
  type ConversationMeta,
  type Issue,
} from "../schemas.js";
import type { ReviewIssue } from "../schemas/review.js";
import type { AgentSessions } from "./agent-sessions.js";
import { prepareStoryChange, requireMergeBase } from "./change.js";
import {
  appendErrorEvent,
  conversationExists,
  createConversation,
  deliverLivePrompt,
  readConversationMeta,
  startConversationPrompt,
} from "./conversations.js";
import { IssueError } from "./errors.js";
import { requireReviewStory } from "./reviews.js";
import { readComments, readIssueOrThrow, readReviewOrThrow } from "./issues.js";
import { requireProjectWorkspace } from "./project-workspace.js";
import {
  REVIEW_QUESTION_ROLE,
  activeResearcherConversationId,
  recordResearcherRunEnd,
  researcherRunForThread,
  trackResearcherLaunch,
} from "./researcher-runs.js";
import { loadRoleBody, loadRoleModelPin } from "./role-bodies.js";
import { appendThreadEvent, findThreadRoot } from "./thread-events.js";

const TITLE_EXCERPT_LENGTH = 60;

const RETRY_NOT_FAILED =
  "only a question whose researcher failed can be retried";

function titleFor(question: string): string {
  const line = question.trim().split("\n")[0]!;
  const excerpt =
    line.length > TITLE_EXCERPT_LENGTH
      ? `${line.slice(0, TITLE_EXCERPT_LENGTH - 1)}…`
      : line;
  return `Researcher: ${excerpt}`;
}

function anchorLine(anchor: NonNullable<Comment["anchor"]>): string {
  if (!isLineAnchor(anchor)) {
    return `Anchor: ${anchor.path}, commit ${anchor.commitSha}`;
  }
  const { start, end } = anchorLineRange(anchor);
  const lines = start < end ? `lines ${start}-${end}` : `line ${end}`;
  return `Anchor: ${anchor.path}, ${anchor.side} side, ${lines}, commit ${anchor.commitSha}`;
}

async function scopeLine(
  storyId: string,
  root: Comment,
  workspace: string,
): Promise<string> {
  if (root.anchor) return anchorLine(root.anchor);
  const change = requireMergeBase(
    storyId,
    await prepareStoryChange(storyId, workspace),
  );
  return change.state === "ready" ? `Diff: ${change.range}` : "Diff: none";
}

/** A review and the Story it reviews. */
type ReviewSource = { review: ReviewIssue; story: Issue };

function readReviewSource(reviewId: string): ReviewSource {
  const review = readReviewOrThrow(reviewId);
  return { review, story: readIssueOrThrow(requireReviewStory(review)) };
}

async function contextLines(
  { review, story }: ReviewSource,
  root: Comment,
  workspace: string,
): Promise<string[]> {
  return [
    `Review: ${review.id}`,
    `Story: ${story.id} — ${story.title}`,
    `Thread: ${root.id}`,
    `Workspace: ${workspace}`,
    await scopeLine(story.id, root, workspace),
  ];
}

async function researcherPrompt(
  source: ReviewSource,
  root: Comment,
  workspace: string,
): Promise<string> {
  return [
    loadRoleBody(REVIEW_QUESTION_ROLE).trim(),
    "",
    "A reviewer asked a question about this Story's changes.",
    "",
    ...(await contextLines(source, root, workspace)),
    "Question:",
    root.body,
  ].join("\n");
}

/** A human reply resumes a conversation whose original instructions are far back. */
function followUpPrompt(reviewId: string, threadId: string, body: string): string {
  return [
    `The reviewer replied in thread ${threadId}:`,
    "",
    body,
    "",
    "Answer by running:",
    `issue comment ${reviewId} --reply-to ${threadId} --role agent --name Researcher --body "<answer>"`,
    "Text you write in chat is not shown to the reviewer.",
  ].join("\n");
}

function threadReplies(messages: Comment[], rootId: string): Comment[] {
  return messages.filter((message) => message.replyTo === rootId);
}

function formatThreadHistory(root: Comment, replies: Comment[]): string {
  const turns = [root, ...replies].map((message) => {
    const name = message.name ?? message.role;
    return `${name}:\n${message.body}`;
  });
  return ["Thread:", ...turns].join("\n\n");
}

/** Prompt for a session that replaces an archived or unreadable conversation. */
async function recoveredResearcherPrompt(
  source: ReviewSource,
  root: Comment,
  replies: Comment[],
  workspace: string,
): Promise<string> {
  return [
    loadRoleBody(REVIEW_QUESTION_ROLE).trim(),
    "",
    "The previous researcher conversation for this thread is gone. This is a new session.",
    "Answer the latest reply.",
    "",
    ...(await contextLines(source, root, workspace)),
    "",
    formatThreadHistory(root, replies),
  ].join("\n");
}

/**
 * A recorded researcher conversation that can still take a prompt.
 * Archived and unreadable conversations are gone; the caller starts a new one.
 */
function usableResearcherConversation(
  conversationId: string,
): ConversationMeta | undefined {
  if (!conversationExists(conversationId)) return undefined;
  try {
    const meta = readConversationMeta(conversationId);
    return meta.archived ? undefined : meta;
  } catch (err) {
    // The task's recovery path: a conversation that cannot be read is replaced.
    console.error(
      `researcher conversation ${conversationId} is unrecoverable:`,
      err,
    );
    return undefined;
  }
}

/**
 * Open a researcher conversation and start its run. A failure to start is
 * recorded on that conversation, so the thread shows it with Retry. The
 * `researcher-session` event lands after the run is live or has failed to
 * start, so the thread never names a conversation that is still opening.
 */
async function recordResearcherStartFailure(
  conversationId: string,
  err: unknown,
): Promise<void> {
  console.error(`researcher start failed for ${conversationId}:`, err);
  await appendErrorEvent(
    conversationId,
    err instanceof Error ? err.message : String(err),
  );
  recordResearcherRunEnd(conversationId);
}

/** Record that a researcher prompt never became a live run. */
async function settleResearcherStart(
  conversationId: string,
  start: () => Promise<{ ok: boolean }>,
): Promise<void> {
  try {
    const started = await start();
    if (!started.ok) recordResearcherRunEnd(conversationId);
  } catch (err) {
    await recordResearcherStartFailure(conversationId, err);
  }
}

async function openResearcherConversation(
  reviewId: string,
  root: Comment,
  projectId: string,
  sessions: AgentSessions,
  promptFor: (workspace: string) => Promise<string>,
  recovered?: true,
): Promise<void> {
  const conversation = await createConversation({
    title: titleFor(root.body),
    projectId,
    model: loadRoleModelPin(REVIEW_QUESTION_ROLE),
    issueId: reviewId,
    channel: "review",
    role: REVIEW_QUESTION_ROLE,
  });
  try {
    const workspace = requireProjectWorkspace(projectId);
    const prompt = await promptFor(workspace);
    await settleResearcherStart(conversation.id, () =>
      startConversationPrompt(
        conversation.id,
        prompt,
        conversation.model,
        sessions,
      ),
    );
  } catch (err) {
    await recordResearcherStartFailure(conversation.id, err);
  }
  await appendThreadEvent(reviewId, root.id, {
    event: "researcher-session",
    conversationId: conversation.id,
    ...(recovered ? { recovered: true } : {}),
    by: { role: "agent", name: "Researcher" },
  });
}

/**
 * Open a fresh researcher conversation for a question root on a review and
 * start its run.
 */
async function startQuestionResearcher(
  reviewId: string,
  root: Comment,
  projectId: string,
  sessions: AgentSessions,
): Promise<void> {
  await openResearcherConversation(
    reviewId,
    root,
    projectId,
    sessions,
    (workspace) => researcherPrompt(readReviewSource(reviewId), root, workspace),
  );
}

/** Fresh researcher session with full thread history after a conversation is gone or retry. */
async function replaceResearcherWithRecoveredHistory(
  reviewId: string,
  root: Comment,
  replies: Comment[],
  projectId: string,
  sessions: AgentSessions,
  conversationId?: string,
): Promise<void> {
  if (conversationId) await sessions.dispose(conversationId);
  const source = readReviewSource(reviewId);
  await openResearcherConversation(
    reviewId,
    root,
    projectId,
    sessions,
    (workspace) => recoveredResearcherPrompt(source, root, replies, workspace),
    true,
  );
}

/**
 * Open question for a human reply. Dismissed questions, converted threads,
 * and review threads leave the researcher as it is.
 */
function openQuestionFollowUp(
  comments: CommentsResponse,
  reply: Comment,
): { root: Comment; conversationId: string } | undefined {
  const thread = comments.threads.find((view) => view.rootId === reply.replyTo);
  const conversationId = thread && activeResearcherConversationId(thread);
  if (!thread || !conversationId) return undefined;
  const root = findThreadRoot(comments.messages, thread.rootId);
  return { root, conversationId };
}

/**
 * Resume an open question thread's researcher with a human reply.
 * A live run receives the reply; a gone conversation is replaced.
 */
async function followUpQuestionResearcher(
  issueId: string,
  reply: Comment,
  projectId: string,
  sessions: AgentSessions,
): Promise<void> {
  const comments = readComments(issueId);
  const target = openQuestionFollowUp(comments, reply);
  if (!target) return;
  const { root, conversationId } = target;
  const meta = usableResearcherConversation(conversationId);
  if (!meta) {
    await replaceResearcherWithRecoveredHistory(
      issueId,
      root,
      threadReplies(comments.messages, root.id),
      projectId,
      sessions,
      conversationId,
    );
    return;
  }

  const prompt = followUpPrompt(issueId, root.id, reply.body);
  const active = sessions.getActiveRun(conversationId);
  try {
    if (active) {
      await deliverLivePrompt(conversationId, prompt, (text) =>
        active.steer(text),
      );
      return;
    }
    await settleResearcherStart(conversationId, () =>
      startConversationPrompt(
        conversationId,
        prompt,
        meta.model,
        sessions,
      ),
    );
  } catch (err) {
    await recordResearcherStartFailure(conversationId, err);
  }
}

/**
 * Start a researcher for a new question, or resume one for a human reply.
 * The thread reads as running from this call until the launch settles.
 * Question threads exist only on a review; on any other issue this does nothing.
 */
export async function onQuestionComment(
  issueId: string,
  message: Comment,
  projectId: string,
  sessions: AgentSessions,
): Promise<void> {
  if (message.kind === "question") {
    await trackResearcherLaunch(message.id, () =>
      startQuestionResearcher(issueId, message, projectId, sessions),
    );
    return;
  }
  // Review threads and non-human replies do not resume a researcher.
  if (message.replyTo && message.role === "human") {
    await trackResearcherLaunch(message.replyTo, () =>
      followUpQuestionResearcher(issueId, message, projectId, sessions),
    );
  }
}

/** Start a fresh researcher run for a question whose last researcher failed. */
export async function retryQuestionResearcher(
  reviewId: string,
  threadId: string,
  projectId: string,
  sessions: AgentSessions,
): Promise<void> {
  const comments = readComments(reviewId);
  const root = findThreadRoot(comments.messages, threadId);
  if (researcherRunForThread(comments, threadId)?.status !== "failed") {
    throw new IssueError("conflict", RETRY_NOT_FAILED);
  }
  const replies = threadReplies(comments.messages, root.id);
  const thread = comments.threads.find((view) => view.rootId === threadId);
  const conversationId = thread && activeResearcherConversationId(thread);
  await trackResearcherLaunch(
    threadId,
    replies.length === 0
      ? () => startQuestionResearcher(reviewId, root, projectId, sessions)
      : () =>
          replaceResearcherWithRecoveredHistory(
            reviewId,
            root,
            replies,
            projectId,
            sessions,
            conversationId,
          ),
  );
}
