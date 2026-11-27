import { request } from "@/lib/api/client";
import type {
  ChannelSessionListItem,
  ChannelSessionPair,
  ConversationChannel,
  OutlineSessionRole,
} from "@server/schemas";

export type CreateChannelSessionBody = {
  model: string;
  title: string;
  message: string;
};

export type CreateChannelSessionResult = {
  id: string;
};

/** Create a session on an issue channel and start its first run. */
export function createChannelSession(
  issueId: string,
  channel: ConversationChannel,
  body: CreateChannelSessionBody,
): Promise<CreateChannelSessionResult> {
  return request<CreateChannelSessionResult>(
    `/api/issues/${encodeURIComponent(issueId)}/channels/${encodeURIComponent(channel)}/sessions`,
    { method: "POST", body },
  );
}

export type ChannelSessionsBatchResponse = {
  sessions: Record<string, ChannelSessionListItem[]>;
};

export function channelSessionPairKey(
  issueId: string,
  channel: ConversationChannel,
): string {
  return `${issueId}:${channel}`;
}

export function sessionsForPair(
  body: ChannelSessionsBatchResponse,
  issueId: string,
  channel: ConversationChannel,
): ChannelSessionListItem[] {
  const key = channelSessionPairKey(issueId, channel);
  const sessions = body.sessions[key];
  if (!Array.isArray(sessions)) {
    throw new Error(`channel-sessions response missing "${key}"`);
  }
  return sessions;
}

export function fetchChannelSessions(
  pairs: readonly ChannelSessionPair[],
): Promise<ChannelSessionsBatchResponse> {
  return request<ChannelSessionsBatchResponse>("/api/channel-sessions", {
    method: "POST",
    body: { pairs },
  });
}

/** List sessions anchored to an issue channel (updatedAt desc). */
export async function listChannelSessions(
  issueId: string,
  channel: ConversationChannel,
): Promise<ChannelSessionListItem[]> {
  const body = await fetchChannelSessions([{ issueId, channel }]);
  return sessionsForPair(body, issueId, channel);
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

const OUTLINE_SESSION_ROLE_LABELS: Record<OutlineSessionRole, string> = {
  planner: "Planner",
  decomposer: "Decomposer",
  reconcile: "Reconcile",
  reconciler: "Reconciler",
  polish: "Plan polish",
  check: "Outline check",
  "mockup-author": "Mockup author",
};

/** Picker name for an outline session's role. */
export function outlineSessionRoleLabel(role: OutlineSessionRole): string {
  return OUTLINE_SESSION_ROLE_LABELS[role];
}

/**
 * Planning-tab rows. A session with no stored role is a planner. Does not
 * pull in the decomposition channel.
 */
export function labelPlanningSessions(
  sessions: readonly ChannelSessionListItem[],
): ChannelSessionListItem[] {
  return sessions.map((session) =>
    session.outlineRole === undefined
      ? { ...session, outlineRole: "planner" as const }
      : session,
  );
}

/** A channel session the server just started. */
export type StartedChannelSession = {
  id: string;
  title: string;
  model: string;
};

/** Start a planner on an outline. `brief` is the only field the route accepts. */
export function startOutlinePlanningSession(
  outlineId: string,
  brief: string,
): Promise<StartedChannelSession> {
  return request<StartedChannelSession>(
    `/api/issues/${encodeURIComponent(outlineId)}/planning/sessions`,
    { method: "POST", body: { brief } },
  );
}

export function formatSessionStartTime(createdAt: string): string {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return createdAt;
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Role name and start-time line for one session switcher row. */
export function channelSessionSwitcherParts(session: ChannelSessionListItem): {
  role?: string;
  when: string;
} {
  const time = formatSessionStartTime(session.createdAt);
  const when = session.archived ? `${time} · archived` : time;
  if (session.outlineRole === undefined) return { when };
  return { role: outlineSessionRoleLabel(session.outlineRole), when };
}

/** Switcher row label: outline role, when the session has one, then start time. */
export function formatChannelSessionSwitcherLabel(
  session: ChannelSessionListItem,
): string {
  const { role, when } = channelSessionSwitcherParts(session);
  return role === undefined ? when : `${role} · ${when}`;
}
