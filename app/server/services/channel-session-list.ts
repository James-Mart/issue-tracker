import {
  assertChannelSessionListItem,
  type ChannelSessionListItem,
  type ChannelSessionPair,
  type ConversationChannel,
  type ConversationMeta,
} from "../schemas.js";
import type { AgentSessions } from "./agent-sessions.js";
import { listIndexedConversationMetas } from "./conversation-meta-index.js";
import { resolveAwaitingHuman } from "./conversations.js";

export function channelSessionPairKey(
  issueId: string,
  channel: ConversationChannel,
): string {
  return `${issueId}:${channel}`;
}

/**
 * Channel sessions for each requested pair, read from the in-memory metadata
 * index. Each list is updatedAt descending. A pair with no sessions is an
 * empty list.
 */
export async function listChannelSessionsForPairs(
  pairs: readonly ChannelSessionPair[],
  sessions: AgentSessions,
): Promise<Record<string, ChannelSessionListItem[]>> {
  const buckets: { key: string; metas: ConversationMeta[] }[] = [];
  const grouped = new Map<string, ConversationMeta[]>();
  for (const pair of pairs) {
    const key = channelSessionPairKey(pair.issueId, pair.channel);
    if (grouped.has(key)) continue;
    const metas: ConversationMeta[] = [];
    grouped.set(key, metas);
    buckets.push({ key, metas });
  }

  for (const meta of listIndexedConversationMetas()) {
    if (!meta.issueId || !meta.channel) continue;
    const bucket = grouped.get(
      channelSessionPairKey(meta.issueId, meta.channel),
    );
    if (bucket) bucket.push(meta);
  }

  const selected: ConversationMeta[] = [];
  for (const bucket of buckets) {
    bucket.metas.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    selected.push(...bucket.metas);
  }

  const awaiting = await awaitingHumanFlags(selected);
  const awaitingById = new Map(
    selected.map((meta, index) => [meta.id, awaiting[index]] as const),
  );
  const byKey: Record<string, ChannelSessionListItem[]> = {};
  for (const bucket of buckets) {
    byKey[bucket.key] = bucket.metas.map((meta) => {
      const awaitingHuman = awaitingById.get(meta.id);
      if (awaitingHuman === undefined) {
        throw new Error(
          `channel session ${meta.id} has no awaitingHuman flag`,
        );
      }
      return assertChannelSessionListItem({
        id: meta.id,
        title: meta.title,
        model: meta.model,
        createdAt: meta.createdAt,
        updatedAt: meta.updatedAt,
        archived: meta.archived,
        activeRun: sessions.getActiveRun(meta.id) !== undefined,
        awaitingHuman,
      });
    });
  }
  return byKey;
}

async function awaitingHumanFlags(
  metas: readonly ConversationMeta[],
): Promise<boolean[]> {
  if (
    metas.every(
      (meta): meta is ConversationMeta & { awaitingHuman: boolean } =>
        meta.awaitingHuman !== undefined,
    )
  ) {
    return metas.map((meta) => meta.awaitingHuman);
  }
  return Promise.all(
    metas.map((meta) =>
      meta.awaitingHuman !== undefined
        ? meta.awaitingHuman
        : resolveAwaitingHuman(meta),
    ),
  );
}
