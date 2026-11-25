import { AGENT_RUNS_SURFACE_LABEL } from "@/features/agents/lib/agent-runs-surface-label";
import { channelForIssue, offersOutlineChannels } from "@server/kind";
import type { ConversationChannel, Issue, IssueKind } from "@server/schemas";

export const DEFAULT_ISSUE_DETAIL_TAB = "overview" as const;
export const AGENTS_DETAIL_TAB = "agents" as const;
export const AGENTS_DETAIL_TAB_LABEL = AGENT_RUNS_SURFACE_LABEL;
export const DIFF_DETAIL_TAB = "diff" as const;

export type IssueDetailTabKey =
  | typeof DEFAULT_ISSUE_DETAIL_TAB
  | typeof AGENTS_DETAIL_TAB
  | typeof DIFF_DETAIL_TAB
  | ConversationChannel;

export type IssueDetailTab =
  | { key: typeof DEFAULT_ISSUE_DETAIL_TAB; label: "Overview" }
  | { key: typeof AGENTS_DETAIL_TAB; label: typeof AGENTS_DETAIL_TAB_LABEL }
  | { key: typeof DIFF_DETAIL_TAB; label: "Diff" }
  | { key: ConversationChannel; label: string; channel: ConversationChannel };

const ISSUE_DETAIL_TAB_LABELS = {
  overview: "Overview",
  agents: AGENTS_DETAIL_TAB_LABEL,
  diff: "Diff",
  planning: "Planning",
  decomposition: "Decomposition",
  implementing: "Implementing",
  review: "Review",
  mockups: "Mockups",
} as const;

/** Channel tab for an issue, when the kind offers one. */
export function channelTabForIssue(
  issue: Issue,
  parentKind?: IssueKind,
): ConversationChannel | undefined {
  if (issue.kind === "story") {
    if (parentKind === undefined) return undefined;
    return channelForIssue(issue, parentKind);
  }
  return channelForIssue(issue);
}

/** Activity tab for Task and Story (once its parent is known) — kind-only, not data-dependent. */
export function agentsTabForIssue(
  issue: Issue,
  parentKind?: IssueKind,
): boolean {
  if (issue.kind === "task") return true;
  return issue.kind === "story" && parentKind !== undefined;
}

/** Diff tab for Task and Story — kind-only, not data-dependent. */
export function diffTabForIssue(issue: Issue): boolean {
  return issue.kind === "task" || issue.kind === "story";
}

function appendChannelTab(
  tabs: IssueDetailTab[],
  channel: ConversationChannel,
): void {
  tabs.push({
    key: channel,
    label: ISSUE_DETAIL_TAB_LABELS[channel],
    channel,
  });
}

/**
 * Page-level tab set for issue detail: Overview always; channel tabs,
 * Activity, and Diff. An outline has Planning and Decomposition. The project
 * issue uses the home bar instead of this set.
 */
export function tabsForIssueDetail(
  issue: Issue,
  parentKind?: IssueKind,
): IssueDetailTab[] {
  const tabs: IssueDetailTab[] = [
    {
      key: DEFAULT_ISSUE_DETAIL_TAB,
      label: ISSUE_DETAIL_TAB_LABELS.overview,
    },
  ];
  if (offersOutlineChannels(issue)) {
    appendChannelTab(tabs, "planning");
    appendChannelTab(tabs, "decomposition");
  } else {
    const channel = channelTabForIssue(issue, parentKind);
    if (channel) appendChannelTab(tabs, channel);
  }
  if (agentsTabForIssue(issue, parentKind)) {
    tabs.push({
      key: AGENTS_DETAIL_TAB,
      label: ISSUE_DETAIL_TAB_LABELS.agents,
    });
  }
  if (diffTabForIssue(issue)) {
    tabs.push({ key: DIFF_DETAIL_TAB, label: ISSUE_DETAIL_TAB_LABELS.diff });
  }
  return tabs;
}

function tabTitleSuffix(tab: IssueDetailTab): string | undefined {
  if (tab.key === DEFAULT_ISSUE_DETAIL_TAB) return undefined;
  return tab.label;
}

function suffixForUnloadedTabKey(tabParam: string): string | undefined {
  if (tabParam === DEFAULT_ISSUE_DETAIL_TAB) return undefined;
  if (Object.hasOwn(ISSUE_DETAIL_TAB_LABELS, tabParam)) {
    return ISSUE_DETAIL_TAB_LABELS[
      tabParam as keyof typeof ISSUE_DETAIL_TAB_LABELS
    ];
  }
  return undefined;
}

/**
 * Suffix for the issue-detail tab title. Overview has none. Every other
 * eligible tab uses its label. Without `tabs`, only static tab keys produce
 * a suffix.
 */
export function issueDetailTabTitleSuffix(
  tabParam: string | null,
  tabs?: readonly IssueDetailTab[],
): string | undefined {
  if (tabs) {
    const active = resolveIssueDetailTab(tabParam, tabs);
    const tab = tabs.find((item) => item.key === active);
    if (!tab) return undefined;
    return tabTitleSuffix(tab);
  }
  if (tabParam == null) return undefined;
  return suffixForUnloadedTabKey(tabParam);
}

/** True when the tabs are an outline's Planning and Decomposition pair. */
export function isOutlinePlanningDecompositionTabSet(
  tabs: readonly IssueDetailTab[],
): boolean {
  return (
    tabs.some((tab) => tab.key === "planning") &&
    tabs.some((tab) => tab.key === "decomposition")
  );
}

/** Visible name for an outline channel tab. */
export function issueDetailChannelLabel(
  channel: "planning" | "decomposition",
): "Planning" | "Decomposition" {
  return ISSUE_DETAIL_TAB_LABELS[channel];
}

/**
 * Parse `tab` against the eligible set. Missing or ineligible values open
 * Overview.
 */
export function resolveIssueDetailTab(
  value: string | null,
  tabs: readonly IssueDetailTab[],
): IssueDetailTabKey {
  if (value != null && tabs.some((tab) => tab.key === value)) {
    return value as IssueDetailTabKey;
  }
  return DEFAULT_ISSUE_DETAIL_TAB;
}

/**
 * Write tab into search params. Default (`overview`) omits the param so the
 * URL stays clean when absent means Overview.
 */
export function writeIssueDetailTabParam(
  params: URLSearchParams,
  tab: IssueDetailTabKey,
): URLSearchParams {
  const next = new URLSearchParams(params);
  if (tab === DEFAULT_ISSUE_DETAIL_TAB) {
    next.delete("tab");
  } else {
    next.set("tab", tab);
  }
  return next;
}

export const DIFF_THREAD_SEARCH_PARAM = "thread";

/** Switch to Diff and name the thread the panel should scroll to. */
export function writeDiffThreadSearchParam(
  params: URLSearchParams,
  threadId: string,
): URLSearchParams {
  const next = writeIssueDetailTabParam(params, DIFF_DETAIL_TAB);
  next.set(DIFF_THREAD_SEARCH_PARAM, threadId);
  return next;
}

export function readDiffThreadSearchParam(
  params: URLSearchParams,
): string | null {
  const value = params.get(DIFF_THREAD_SEARCH_PARAM);
  return value ? value : null;
}

/**
 * Hash of a comment or thread already used as an in-page target.
 * `#comments` is the section, not a comment. A hand-edited fragment can be
 * invalid percent-encoding.
 */
export function hashCommentTarget(hash: string): string | null {
  if (!hash.startsWith("#") || hash === "#comments") return null;
  try {
    const id = decodeURIComponent(hash.slice(1));
    return id.length > 0 ? id : null;
  } catch {
    return null;
  }
}

/**
 * Channel tabs need the Agents-style bounded page shell so the transcript
 * scrolls internally and the composer stays pinned. Overview (and other
 * document tabs) keep unbounded page scroll.
 */
export function issueDetailTabNeedsBoundedShell(
  active: IssueDetailTabKey,
  tabs: readonly IssueDetailTab[],
): boolean {
  return tabs.some((tab) => tab.key === active && "channel" in tab);
}

/**
 * Phone channel tabs take the viewport and hide the issue tab bar.
 */
export function mobileChannelChromeForTab(
  isMobile: boolean,
  active: IssueDetailTabKey,
  tabs: readonly IssueDetailTab[],
): boolean {
  return isMobile && issueDetailTabNeedsBoundedShell(active, tabs);
}