import { anchorLineRange } from "@/features/issues/lib/comment-anchor-snippet";
import type { Comment, Issue } from "../schemas.js";
import type { AgentSessions } from "./agent-sessions.js";
import { prepareStoryChange, requireMergeBase } from "./change.js";
import {
  appendErrorEvent,
  createConversation,
  startConversationPrompt,
} from "./conversations.js";
import { IssueError } from "./errors.js";
import { readComments, readIssueOrThrow } from "./issues.js";
import { requireProjectWorkspace } from "./project-workspace.js";
import {
  REVIEW_QUESTION_ROLE,
  researcherRunForThread,
} from "./researcher-runs.js";
import { loadRoleBody, loadRoleModelPin } from "./role-bodies.js";
import { appendThreadEvent, findThreadRoot } from "./thread-events.js";

const TITLE_EXCERPT_LENGTH = 60;

export const RETRY_NOT_FAILED =
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

export async function researcherPrompt(
  story: Issue,
  root: Comment,
  workspace: string,
): Promise<string> {
  return [
    loadRoleBody(REVIEW_QUESTION_ROLE).trim(),
    "",
    "A reviewer asked a question about this Story's changes.",
    "",
    `Story: ${story.id} — ${story.title}`,
    `Thread: ${root.id}`,
    `Workspace: ${workspace}`,
    await scopeLine(story.id, root, workspace),
    "Question:",
    root.body,
  ].join("\n");
}

/**
 * Open a fresh researcher conversation for a question root on a Story and
 * start its run. A failure to start is recorded on that conversation, so the
 * thread shows it with Retry. The `researcher-session` event lands after the
 * run is live, so the thread never names a conversation that is still starting.
 */
export async function startQuestionResearcher(
  storyId: string,
  root: Comment,
  projectId: string,
  sessions: AgentSessions,
): Promise<void> {
  const conversation = await createConversation({
    title: titleFor(root.body),
    projectId,
    model: loadRoleModelPin(REVIEW_QUESTION_ROLE),
    issueId: storyId,
    channel: "review",
  });
  try {
    const workspace = requireProjectWorkspace(projectId);
    const prompt = await researcherPrompt(
      readIssueOrThrow(storyId),
      root,
      workspace,
    );
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
    by: { role: "agent", name: "Researcher" },
  });
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
  await startQuestionResearcher(storyId, root, projectId, sessions);
}
