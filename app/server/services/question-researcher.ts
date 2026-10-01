import { anchorLineRange } from "@/features/issues/lib/comment-anchor-snippet";
import {
  isLineAnchor,
  type Comment,
  type CommentsResponse,
  type ConversationMeta,
  type Issue,
} from "../schemas.js";
import type { AgentSessions } from "./agent-sessions.js";
import { prepareStoryChange, requireMergeBase } from "./change.js";
import {
  appendErrorEvent,
  conversationExists,
  createConversation,
  deliverLivePrompt,
  readConversation,
  startConversationPrompt,
} from "./conversations.js";
import { IssueError } from "./errors.js";
import { readComments, readIssueOrThrow } from "./issues.js";
import { requireProjectWorkspace } from "./project-workspace.js";
import {
  REVIEW_QUESTION_ROLE,
  activeResearcherConversationId,
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

async function contextLines(
  story: Issue,
  root: Comment,
  workspace: string,
): Promise<string[]> {
  return [
    `Story: ${story.id} — ${story.title}`,
    `Thread: ${root.id}`,
    `Workspace: ${workspace}`,
    await scopeLine(story.id, root, workspace),
  ];
}

async function researcherPrompt(
  story: Issue,
  root: Comment,
  workspace: string,
): Promise<string> {
  return [
    loadRoleBody(REVIEW_QUESTION_ROLE).trim(),
    "",
    "A reviewer asked a question about this Story's changes.",
    "",
    ...(await contextLines(story, root, workspace)),
    "Question:",
    root.body,
  ].join("\n");
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
  story: Issue,
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
    ...(await contextLines(story, root, workspace)),
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
    const { meta } = readConversation(conversationId);
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
 * `researcher-session` event lands after the run is live, so the thread never
 * names a conversation that is still starting.
 */
async function openResearcherConversation(
  storyId: string,
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
    issueId: storyId,
    channel: "review",
    role: REVIEW_QUESTION_ROLE,
  });
  try {
    const workspace = requireProjectWorkspace(projectId);
    const prompt = await promptFor(workspace);
    await startConversationPrompt(
      conversation.id,
      prompt,
      conversation.model,
      sessions,
    );
  } catch (err) {
    console.error(`researcher start failed for ${conversation.id}:`, err);
    await appendErrorEvent(
      conversation.id,
      err instanceof Error ? err.message : String(err),
    );
  }
  await appendThreadEvent(storyId, root.id, {
    event: "researcher-session",
    conversationId: conversation.id,
    ...(recovered ? { recovered: true } : {}),
    by: { role: "agent", name: "Researcher" },
  });
}

/**
 * Open a fresh researcher conversation for a question root on a Story and
 * start its run.
 */
async function startQuestionResearcher(
  storyId: string,
  root: Comment,
  projectId: string,
  sessions: AgentSessions,
): Promise<void> {
  await openResearcherConversation(
    storyId,
    root,
    projectId,
    sessions,
    (workspace) =>
      researcherPrompt(readIssueOrThrow(storyId), root, workspace),
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
  storyId: string,
  reply: Comment,
  projectId: string,
  sessions: AgentSessions,
): Promise<void> {
  const comments = readComments(storyId);
  const target = openQuestionFollowUp(comments, reply);
  if (!target) return;
  const { root, conversationId } = target;
  const meta = usableResearcherConversation(conversationId);
  if (!meta) {
    // Drop a live handle for this id before a replacement conversation can
    // reuse it. A deleted conversation frees its slug.
    await sessions.dispose(conversationId);
    const replies = comments.messages.filter(
      (message) => message.replyTo === root.id,
    );
    await openResearcherConversation(
      storyId,
      root,
      projectId,
      sessions,
      (workspace) =>
        recoveredResearcherPrompt(
          readIssueOrThrow(storyId),
          root,
          replies,
          workspace,
        ),
      true,
    );
    return;
  }

  const active = sessions.getActiveRun(conversationId);
  try {
    if (active) {
      await deliverLivePrompt(conversationId, reply.body, (text) =>
        active.steer(text),
      );
      return;
    }
    await startConversationPrompt(
      conversationId,
      reply.body,
      meta.model,
      sessions,
    );
  } catch (err) {
    console.error(`researcher follow-up failed for ${conversationId}:`, err);
    await appendErrorEvent(
      conversationId,
      err instanceof Error ? err.message : String(err),
    );
  }
}

/**
 * Start a researcher for a new question, or resume one for a human reply.
 * The thread reads as starting from this call until the launch settles.
 */
export async function onQuestionComment(
  storyId: string,
  message: Comment,
  projectId: string,
  sessions: AgentSessions,
): Promise<void> {
  if (message.kind === "question") {
    await trackResearcherLaunch(message.id, () =>
      startQuestionResearcher(storyId, message, projectId, sessions),
    );
    return;
  }
  // Review threads and non-human replies do not resume a researcher.
  if (message.replyTo && message.role === "human") {
    await trackResearcherLaunch(message.replyTo, () =>
      followUpQuestionResearcher(storyId, message, projectId, sessions),
    );
  }
}

/** Start a fresh researcher run for a question whose last researcher failed. */
export async function retryQuestionResearcher(
  storyId: string,
  threadId: string,
  projectId: string,
  sessions: AgentSessions,
): Promise<void> {
  const comments = readComments(storyId);
  const root = findThreadRoot(comments.messages, threadId);
  if (researcherRunForThread(comments, threadId)?.status !== "failed") {
    throw new IssueError("conflict", RETRY_NOT_FAILED);
  }
  await trackResearcherLaunch(threadId, () =>
    startQuestionResearcher(storyId, root, projectId, sessions),
  );
}
