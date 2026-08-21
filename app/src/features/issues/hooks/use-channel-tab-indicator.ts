import type { ConversationChannel } from "@server/schemas";
import { currentChannelSession } from "../api/channel-sessions";
import { useChannelSessionsQuery } from "../api/queries";
import {
  channelTabIndicator,
  type ChannelTabIndicator,
} from "../lib/channel-tab-indicator";

/**
 * Live decoration for a channel tab: pulsing dot while the current session
 * runs, warn accent when that session is idle and waiting on the human.
 */
export function useChannelTabIndicator(
  issueId: string,
  channel: ConversationChannel,
): ChannelTabIndicator | null {
  const { data } = useChannelSessionsQuery(issueId, channel);
  const session = currentChannelSession(data ?? []);
  return channelTabIndicator(
    Boolean(session),
    session?.activeRun ?? false,
    session?.awaitingHuman ?? false,
  );
}
