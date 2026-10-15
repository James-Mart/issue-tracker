import type { AgentSessions } from "./agent-sessions.js";
import {
  deliverLivePrompt,
  readConversationMeta,
  setPendingMessage,
  startConversationPrompt,
} from "./conversations.js";
import {
  assertGuestAllowsAgentLaunch,
  GUEST_REFUSED_CONVERSATION_MESSAGE,
} from "./guest-agent-launch.js";
import { readIssueOrThrow } from "./issues.js";
import { refuseWorkQueueConflict } from "./work-queue.js";

const MESSAGE_ROOT_PARKED = "parked";

export type ConversationMessageSessions = Pick<
  AgentSessions,
  "getActiveRun" | "sendPrompt"
>;

export type ConversationMessageDelivery =
  | { status: "steered" }
  | { status: "pending" }
  | { status: "started"; runId: string }
  | { status: "failed"; message: string };

/**
 * A parked root holds no implementing slot, so a new turn on its coordinator
 * must wait in the queue: resume the root with the message as its note.
 */
function refuseTurnOnParkedRoot(conversationId: string): void {
  const meta = readConversationMeta(conversationId);
  if (meta.channel !== "implementing" || !meta.issueId) return;
  const root = readIssueOrThrow(meta.issueId);
  if (root.kind !== "epic" && root.kind !== "story") return;
  if (!root.workParkedAt) return;
  refuseWorkQueueConflict(
    MESSAGE_ROOT_PARKED,
    `work root "${root.title}" is parked; resume it to queue a message for its coordinator`,
  );
}

/**
 * Deliver a user message the way `POST /api/conversations/:id/messages` does:
 * steer a live run, queue it when steer does not accept it, or start a turn
 * when the conversation is idle and its work root is not parked.
 */
export async function postConversationMessage(
  conversationId: string,
  prompt: string,
  sessions: ConversationMessageSessions,
  options?: { attachments?: string[] },
): Promise<ConversationMessageDelivery> {
  const attachments = options?.attachments ?? [];
  const activeRun = sessions.getActiveRun(conversationId);
  if (activeRun) {
    assertGuestAllowsAgentLaunch(GUEST_REFUSED_CONVERSATION_MESSAGE);
    if (attachments.length > 0) {
      await setPendingMessage(conversationId, prompt, attachments);
      return { status: "pending" };
    }

    return {
      status: await deliverLivePrompt(conversationId, prompt, (text) =>
        activeRun.steer(text),
      ),
    };
  }

  refuseTurnOnParkedRoot(conversationId);
  const result = await startConversationPrompt(conversationId, prompt, sessions, {
    attachments,
  });
  if (!result.ok) return { status: "failed", message: result.message };
  return { status: "started", runId: result.runId };
}
