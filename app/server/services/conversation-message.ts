import type { AgentSessions, StartClaim } from "./agent-sessions.js";
import { refuseArchivedIdeaPlanning } from "./archived-idea-planning.js";
import {
  deliverLivePrompt,
  readConversationMeta,
  refuseIfSharedRunBusy,
  serialize,
  setPendingMessage,
  sharedRunChannel,
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
  "getActiveRun" | "sendPrompt" | "isBusy" | "claimStart"
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

function refuseMessageOnArchivedIdea(conversationId: string): void {
  const { issueId, channel } = readConversationMeta(conversationId);
  if (issueId && channel) refuseArchivedIdeaPlanning(issueId, channel);
}

/**
 * Deliver a user message the way `POST /api/conversations/:id/messages` does:
 * steer a live run, queue it when steer does not accept it, or start a turn
 * when the conversation is idle and its work root is not parked. An archived
 * Idea's planning conversation refuses every message.
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
    refuseMessageOnArchivedIdea(conversationId);
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

  refuseMessageOnArchivedIdea(conversationId);
  refuseTurnOnParkedRoot(conversationId);
  const result = await startIdleConversationTurn(conversationId, prompt, sessions, {
    attachments,
  });
  if (!result.ok) return { status: "failed", message: result.message };
  return { status: "started", runId: result.runId };
}

/**
 * Refuse while the channel sharing this conversation's live run is busy, and
 * claim this conversation's start in the same write turn so a start there
 * sees this one as busy. Conversations on other channels need no claim.
 */
function claimSharedRunTurn(
  conversationId: string,
  sessions: ConversationMessageSessions,
): Promise<StartClaim | undefined> {
  return serialize(() => {
    const { issueId, channel } = readConversationMeta(conversationId);
    if (!issueId || !channel || !sharedRunChannel(channel)) return undefined;
    refuseIfSharedRunBusy(issueId, channel, sessions);
    return sessions.claimStart(conversationId);
  });
}

/**
 * Start a turn on an idle conversation. On an outline, a live run on its other
 * channel refuses the turn with a `conflict` naming that channel.
 */
export async function startIdleConversationTurn(
  conversationId: string,
  prompt: string,
  sessions: ConversationMessageSessions,
  options?: { attachments?: string[] },
): ReturnType<typeof startConversationPrompt> {
  const claim = await claimSharedRunTurn(conversationId, sessions);
  try {
    return await startConversationPrompt(conversationId, prompt, sessions, options);
  } finally {
    claim?.release();
  }
}
