import type { ConversationChannel } from "@server/schemas";
import { currentChannelSession } from "../api/channel-sessions";
import { useChannelSessionsQuery } from "../api/queries";
import {
  cockpitLaunchOverlayForIssue,
} from "../lib/cockpit-launch-sync";
import { launchOverlaysChannel } from "../lib/detail-launch-sync";
import {
  channelTabIndicator,
  type ChannelTabIndicator,
} from "../lib/channel-tab-indicator";
import { useCockpitLaunchStore } from "../store/use-cockpit-launch-store";

/**
 * Live decoration for a channel tab: pulsing dot while the current session
 * runs, warn accent when that session is idle and waiting on the human.
 */
export function useChannelTabIndicator(
  issueId: string,
  channel: ConversationChannel,
): ChannelTabIndicator | null {
  const { data } = useChannelSessionsQuery(issueId, channel);
  const pending = useCockpitLaunchStore((s) => s.pending);
  const ack = useCockpitLaunchStore((s) => s.ack);
  const overlay = cockpitLaunchOverlayForIssue(issueId, pending, ack);
  if (launchOverlaysChannel(issueId, channel, overlay)) {
    return "active-run";
  }
  const session = currentChannelSession(data ?? []);
  return channelTabIndicator(
    Boolean(session),
    session?.activeRun ?? false,
    session?.awaitingHuman ?? false,
  );
}
