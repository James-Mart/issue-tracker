import {
  postConversationMessage,
  type ConversationMessageSessions,
} from "./conversation-message.js";
import { activeImplementingConversationId } from "./conversations.js";
import {
  ENQUEUE_ALREADY_QUEUED,
  ENQUEUE_HOLDS_SLOT,
  enqueueWorkRoot,
} from "./enqueue-work-root.js";
import { IssueError } from "./errors.js";
import { implementingResumePrompt } from "./implementing-launch.js";

function enqueueReason(err: unknown): string | undefined {
  if (!(err instanceof IssueError)) return undefined;
  const reason = err.details?.reason;
  return typeof reason === "string" ? reason : undefined;
}

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

async function messageSlotHolder(
  workRootId: string,
  message: string,
  sessions: ConversationMessageSessions,
): Promise<void> {
  const existing = activeImplementingConversationId(workRootId);
  if (!existing) {
    throw new IssueError(
      "conflict",
      `work root "${workRootId}" holds a slot without an implementing session`,
    );
  }
  await deliverToCoordinator(existing, message, sessions);
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
 * A root that holds a slot is messaged on its existing session. Any other
 * root is queued; a queued start carries only the work-loop start message.
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
    await enqueueWorkRoot(workRootId, sessions);
  } catch (err) {
    const reason = enqueueReason(err);
    if (reason === ENQUEUE_HOLDS_SLOT) {
      await messageSlotHolder(workRootId, text, sessions);
      return;
    }
    // Already waiting: the later start sends only the work-loop message.
    if (reason === ENQUEUE_ALREADY_QUEUED) return;
    throw err;
  }
}
