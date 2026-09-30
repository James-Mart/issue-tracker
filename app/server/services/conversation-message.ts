import type { AgentSessions } from "./agent-sessions.js";
import {
  deliverLivePrompt,
  setPendingMessage,
  startConversationPrompt,
} from "./conversations.js";

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
 * Deliver a user message the way `POST /api/conversations/:id/messages` does:
 * steer a live run, queue it when steer does not accept it, or start a turn
 * when the conversation is idle.
 */
export async function postConversationMessage(
  conversationId: string,
  prompt: string,
  sessions: ConversationMessageSessions,
  options?: { model?: string; attachments?: string[] },
): Promise<ConversationMessageDelivery> {
  const attachments = options?.attachments ?? [];
  const activeRun = sessions.getActiveRun(conversationId);
  if (activeRun) {
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

  const result = await startConversationPrompt(
    conversationId,
    prompt,
    options?.model,
    sessions,
    { attachments },
  );
  if (!result.ok) return { status: "failed", message: result.message };
  return { status: "started", runId: result.runId };
}
