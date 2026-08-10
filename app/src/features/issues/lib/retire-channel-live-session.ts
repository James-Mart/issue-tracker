import type { ChannelSessionListItem } from "@server/schemas";
import {
  cancelConversationRun,
  updateConversation,
} from "@/features/agents/api/client";

/**
 * Stop an in-flight channel session and archive it via PATCH so the switcher
 * can still reach the transcript.
 */
export async function retireChannelLiveSession(
  sessionId: string,
): Promise<void> {
  await cancelConversationRun(sessionId);
  await updateConversation(sessionId, { archived: true });
}

/** Mark a session archived + idle in a channel-sessions list cache entry. */
export function markChannelSessionRetired(
  sessions: readonly ChannelSessionListItem[] | undefined,
  sessionId: string,
): ChannelSessionListItem[] {
  return (sessions ?? []).map((session) =>
    session.id === sessionId
      ? { ...session, archived: true, activeRun: false }
      : session,
  );
}
