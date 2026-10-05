import {
  postConversationMessage,
  type ConversationMessageSessions,
} from "./conversation-message.js";
import { activeImplementingConversationId } from "./conversations.js";
import { IssueError } from "./errors.js";
import {
  implementingResumePrompt,
  implementingSessionMessage,
  implementingSessionTitle,
} from "./implementing-launch.js";
import { startImplementingChannelSession } from "./implementing-session.js";
import { readIssueOrThrow } from "./issues.js";

async function deliverToCoordinator(
  conversationId: string,
  message: string,
  sessions: ConversationMessageSessions,
): Promise<void> {
  const delivery = await postConversationMessage(
    conversationId,
    message,
    sessions,
  );
  if (delivery.status === "failed") {
    throw new Error(delivery.message);
  }
}

async function startImplementingSession(
  workRootId: string,
  message: string,
  sessions: ConversationMessageSessions,
): Promise<void> {
  const root = readIssueOrThrow(workRootId);
  if (root.kind !== "epic" && root.kind !== "story") {
    throw new IssueError(
      "validation",
      `issue "${workRootId}" is not an implementing work root`,
    );
  }
  const projectId = root.partOf;
  // A new session still opens on the implementing skill. The resume prompt follows.
  await startImplementingChannelSession(
    {
      projectId,
      issueId: workRootId,
      title: implementingSessionTitle(root.title),
      message: `${implementingSessionMessage(workRootId)}\n\n${message}`,
    },
    sessions,
  );
}

/** Resume the work root's implementing coordinator. */
export async function resumeCoordinator(
  workRootId: string,
  sessions: ConversationMessageSessions,
): Promise<void> {
  await bringInCoordinator(workRootId, implementingResumePrompt(), sessions);
}

/**
 * Bring the work root's coordinator in with a message.
 * Archived implementing conversations do not count. An idle coordinator gets
 * a new turn. A coordinator mid-turn is steered or queued the same way a
 * conversation message is.
 */
export async function bringInCoordinator(
  workRootId: string,
  message: string,
  sessions: ConversationMessageSessions,
): Promise<void> {
  const text = message.trim();
  if (!text) {
    throw new IssueError("validation", "coordinator message is required");
  }
  const existing = activeImplementingConversationId(workRootId);
  if (existing) {
    await deliverToCoordinator(existing, text, sessions);
    return;
  }
  try {
    await startImplementingSession(workRootId, text, sessions);
  } catch (err) {
    // This handoff or the work-queue launcher can create an active implementing
    // session after the idle check. Deliver into that holder instead.
    if (!(err instanceof IssueError) || err.code !== "conflict") throw err;
    const holder = activeImplementingConversationId(workRootId);
    if (!holder) throw err;
    await deliverToCoordinator(holder, text, sessions);
  }
}
