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

/** Default panel selection: live session, else newest listed session. */
export function defaultChannelSession(
  sessions: readonly ChannelSessionListItem[],
): ChannelSessionListItem | undefined {
  if (sessions.length === 0) return undefined;
  return (
    currentChannelSession(sessions) ?? orderChannelSessionsForSwitcher(sessions)[0]
  );
}

function byUpdatedAtDesc(
  a: ChannelSessionListItem,
  b: ChannelSessionListItem,
): number {
  return b.updatedAt.localeCompare(a.updatedAt);
}

/** Active sessions first, then archived; each group newest-first. */
export function orderChannelSessionsForSwitcher(
  sessions: readonly ChannelSessionListItem[],
): ChannelSessionListItem[] {
  const active = sessions.filter((session) => !session.archived);
  const archived = sessions.filter((session) => session.archived);
  return [...active.sort(byUpdatedAtDesc), ...archived.sort(byUpdatedAtDesc)];
}

function formatSessionStartTime(createdAt: string): string {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return createdAt;
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Switcher row label: session start time plus archived marker. */
export function formatChannelSessionSwitcherLabel(
  session: ChannelSessionListItem,
): string {
  const time = formatSessionStartTime(session.createdAt);
  return session.archived ? `${time} · archived` : time;
}
