import type { DerivedState, Issue } from "../schemas.js";
import { listConversations } from "./conversations.js";
import { isRunLive } from "./run-live.js";

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

/** True when any issue-anchored conversation on the issue is live (any channel). */
export function liveRunByIssueId(): Record<string, boolean> {
  const byId: Record<string, boolean> = {};
  for (const meta of listConversations()) {
    if (meta.issueId === undefined || !isRunLive(meta.id)) continue;
    byId[meta.issueId] = true;
  }
  return byId;
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
  const implementingSessions = sessionsByIssueChannel("implementing");
  const liveRuns = liveRunByIssueId();

  for (const issue of issues) {
    const liveRun = liveRuns[issue.id] === true;
    const existing = derived[issue.id];
    if (existing) existing.liveRun = liveRun;
    else derived[issue.id] = { blocked: false, liveRun };
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
