import { request } from "@/lib/api/client";
import {
  parseChannelSessionListItem,
  type ChannelSessionListItem,
  type ConversationChannel,
} from "@server/schemas";

function parseChannelSessionList(raw: unknown): ChannelSessionListItem[] {
  if (!Array.isArray(raw)) {
    throw new Error("invalid channel sessions list");
  }
  return raw.map((entry) => {
    const parsed = parseChannelSessionListItem(entry);
    if (!parsed.ok) throw new Error(parsed.message);
    return parsed.item;
  });
}

/** List sessions anchored to an issue channel (updatedAt desc). */
export function listChannelSessions(
  issueId: string,
  channel: ConversationChannel,
): Promise<ChannelSessionListItem[]> {
  return request<unknown>(
    `/api/issues/${encodeURIComponent(issueId)}/channels/${encodeURIComponent(channel)}/sessions`,
  ).then(parseChannelSessionList);
}

/** Most recent non-archived session, or undefined when the channel is idle. */
export function currentChannelSession(
  sessions: readonly ChannelSessionListItem[],
): ChannelSessionListItem | undefined {
  return sessions.find((session) => !session.archived);
}
