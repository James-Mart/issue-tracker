import type { ConversationMeta, DerivedState, Issue } from "../schemas.js";
import { listConversations } from "./conversations.js";
import { isRunLive } from "./run-live.js";

export type ImplementingPresence = { live: boolean };

/**
 * Non-archived implementing sessions per issue. Map presence means the
 * session is open; `live` means one of those sessions has a live run.
 */
type OverlayFacts = {
  liveRuns: Record<string, boolean>;
  /** Implementing session ids, including archived sessions. */
  implementingSessions: Map<string, string[]>;
  openImplementing: Map<string, ImplementingPresence>;
};

function conversationOverlayFacts(
  metas: readonly Pick<
    ConversationMeta,
    "id" | "issueId" | "channel" | "archived"
  >[],
  isLive: (conversationId: string) => boolean,
): OverlayFacts {
  const liveRuns: Record<string, boolean> = {};
  const implementingSessions = new Map<string, string[]>();
  const openImplementing = new Map<string, ImplementingPresence>();
  for (const meta of metas) {
    if (meta.issueId !== undefined && isLive(meta.id)) {
      liveRuns[meta.issueId] = true;
    }
    if (meta.issueId !== undefined && meta.channel === "implementing") {
      const sessions = implementingSessions.get(meta.issueId);
      if (sessions) sessions.push(meta.id);
      else implementingSessions.set(meta.issueId, [meta.id]);
    }
    if (meta.archived || meta.channel !== "implementing" || !meta.issueId) {
      continue;
    }
    const current = openImplementing.get(meta.issueId) ?? { live: false };
    if (isLive(meta.id)) current.live = true;
    openImplementing.set(meta.issueId, current);
  }
  return { liveRuns, implementingSessions, openImplementing };
}

export function openImplementingPresence(
  metas: readonly Pick<
    ConversationMeta,
    "id" | "issueId" | "channel" | "archived"
  >[],
  isLive: (conversationId: string) => boolean,
): Map<string, ImplementingPresence> {
  return conversationOverlayFacts(metas, isLive).openImplementing;
}

function sessionsByIssueChannel(channel: string): Map<string, string[]> {
  const byIssueChannel = new Map<string, string[]>();
  for (const meta of listConversations()) {
    if (meta.issueId === undefined || meta.channel === undefined) continue;
    const key = `${meta.issueId}\0${meta.channel}`;
    const bucket = byIssueChannel.get(key);
    if (bucket) bucket.push(meta.id);
    else byIssueChannel.set(key, [meta.id]);
  }

  const byIssue = new Map<string, string[]>();
  for (const [key, conversationIds] of byIssueChannel) {
    const sep = key.indexOf("\0");
    if (key.slice(sep + 1) !== channel) continue;
    byIssue.set(key.slice(0, sep), conversationIds);
  }
  return byIssue;
}

function isProjectLevelStory(issue: Issue, byId: Map<string, Issue>): boolean {
  return issue.kind === "story" && byId.get(issue.partOf)?.kind === "project";
}

function hasLiveRun(conversationIds: string[] | undefined): boolean {
  return conversationIds?.some((id) => isRunLive(id)) ?? false;
}

/** True when a non-archived implementing session on the issue has a live run. */
export function hasActiveImplementingRun(issueId: string): boolean {
  return hasLiveRun(sessionsByIssueChannel("implementing").get(issueId));
}

/**
 * After `derive()`, overlay live implementing sessions onto Epic / project-level
 * Story status and set `liveRun` on every issue in the graph.
 */
export function mergeImplementingOverlay(
  issues: Issue[],
  derived: Record<string, DerivedState>,
): void {
  const byId = new Map(issues.map((issue) => [issue.id, issue]));
  const { liveRuns, implementingSessions, openImplementing } =
    conversationOverlayFacts(listConversations(), isRunLive);

  for (const issue of issues) {
    const liveRun = liveRuns[issue.id] === true;
    const presence = openImplementing.get(issue.id);
    const existing = derived[issue.id];
    const next = existing ?? { blocked: false };
    next.liveRun = liveRun;
    if (presence) {
      next.implementingOpen = true;
      if (presence.live) next.implementingLive = true;
    }
    if (!existing) derived[issue.id] = next;
  }

  for (const issue of issues) {
    if (issue.kind === "epic") {
      if (!hasLiveRun(implementingSessions.get(issue.id))) continue;
      const state = derived[issue.id];
      if (!state || state.epicStatus === "done") continue;
      state.epicStatus = "in-progress";
      continue;
    }
    if (issue.kind !== "story" || !isProjectLevelStory(issue, byId)) continue;
    if (!hasLiveRun(implementingSessions.get(issue.id))) continue;
    const state = derived[issue.id];
    if (!state) continue;
    const status = state.storyStatus;
    if (status === "merged" || status === "pr-open") continue;
    state.storyStatus = "in-progress";
  }
}
