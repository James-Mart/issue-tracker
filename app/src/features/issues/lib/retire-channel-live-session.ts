import type { QueryClient } from "@tanstack/react-query";
import type { ChannelSessionListItem } from "@server/schemas";
import {
  cancelConversationRun,
  updateConversation,
} from "@/features/agents/api/client";
import { issuesKeys } from "../api/keys";

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

/** Patch `activeRun` for one session in a channel-sessions list cache entry. */
export function markChannelSessionActiveRun(
  sessions: readonly ChannelSessionListItem[] | undefined,
  sessionId: string,
  activeRun: boolean,
): ChannelSessionListItem[] {
  return (sessions ?? []).map((session) =>
    session.id === sessionId ? { ...session, activeRun } : session,
  );
}

/**
 * Keep every cached channel-sessions list in sync when a session's run state
 * changes (Stop, interject, SSE run frames). Issue-anchored sessions are
 * omitted from the Agents roster, so the roster invalidation alone is not enough.
 */
export function patchChannelSessionActiveRunInCache(
  qc: QueryClient,
  sessionId: string,
  activeRun: boolean,
): void {
  const entries = qc.getQueriesData<ChannelSessionListItem[]>({
    queryKey: [...issuesKeys.all, "channelSessions"],
  });
  for (const [key, sessions] of entries) {
    if (!sessions?.some((session) => session.id === sessionId)) continue;
    qc.setQueryData(
      key,
      markChannelSessionActiveRun(sessions, sessionId, activeRun),
    );
  }
}
