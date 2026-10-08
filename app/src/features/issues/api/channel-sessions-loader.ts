import type {
  ChannelSessionListItem,
  ChannelSessionPair,
  ConversationChannel,
} from "@server/schemas";
import {
  channelSessionPairKey,
  fetchChannelSessions,
  sessionsForPair,
} from "./channel-sessions";

type ChannelSessionWaiter = ChannelSessionPair & {
  resolve: (sessions: ChannelSessionListItem[]) => void;
  reject: (error: unknown) => void;
};

/** Same-turn loads share one POST. Flushed as a microtask. */
let pendingChannelSessions: ChannelSessionWaiter[] | null = null;

async function deliverChannelSessions(
  waiters: readonly ChannelSessionWaiter[],
): Promise<void> {
  const pairs: ChannelSessionPair[] = [];
  const seen = new Set<string>();
  for (const waiter of waiters) {
    const key = channelSessionPairKey(waiter.issueId, waiter.channel);
    if (seen.has(key)) continue;
    seen.add(key);
    pairs.push({ issueId: waiter.issueId, channel: waiter.channel });
  }
  try {
    const body = await fetchChannelSessions(pairs);
    for (const waiter of waiters) {
      try {
        waiter.resolve(sessionsForPair(body, waiter.issueId, waiter.channel));
      } catch (error) {
        waiter.reject(error);
      }
    }
  } catch (error) {
    for (const waiter of waiters) waiter.reject(error);
  }
}

/**
 * Load one channel's sessions for `useChannelSessionsQuery`, coalescing every
 * call from this turn into a single `POST /api/channel-sessions`.
 */
export function loadChannelSessions(
  issueId: string,
  channel: ConversationChannel,
): Promise<ChannelSessionListItem[]> {
  return new Promise((resolve, reject) => {
    const waiter: ChannelSessionWaiter = { issueId, channel, resolve, reject };
    if (pendingChannelSessions) {
      pendingChannelSessions.push(waiter);
      return;
    }
    pendingChannelSessions = [waiter];
    queueMicrotask(() => {
      const waiters = pendingChannelSessions;
      pendingChannelSessions = null;
      if (waiters) void deliverChannelSessions(waiters);
    });
  });
}
