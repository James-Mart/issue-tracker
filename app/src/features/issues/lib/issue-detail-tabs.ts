import { SUPPORTING_DOC_KEYS } from "@server/issue-constants";
import { channelForIssue } from "@server/kind";
import type {
  ConversationChannel,
  IdeaStatus,
  Issue,
  IssueKind,
} from "@server/schemas";
import type { ChannelTabIndicator } from "./channel-tab-indicator";
import {
  previewableSupportingDocs,
  type SupportingDocPreviewTab,
} from "./supporting-docs";

export const DEFAULT_ISSUE_DETAIL_TAB = "overview" as const;
export const AGENTS_DETAIL_TAB = "agents" as const;
export const DIFF_DETAIL_TAB = "diff" as const;

export type IssueDetailTabKey =
  | typeof DEFAULT_ISSUE_DETAIL_TAB
  | typeof AGENTS_DETAIL_TAB
  | typeof DIFF_DETAIL_TAB
  | ConversationChannel
  | SupportingDocPreviewTab["key"];

export type IssueDetailTab =
  | { key: typeof DEFAULT_ISSUE_DETAIL_TAB; label: "Overview" }
  | { key: typeof AGENTS_DETAIL_TAB; label: "Agents" }
  | { key: typeof DIFF_DETAIL_TAB; label: "Diff" }
  | { key: ConversationChannel; label: string; channel: ConversationChannel }
  | SupportingDocPreviewTab;

const ISSUE_DETAIL_TAB_LABELS = {
  overview: "Overview",
  agents: "Agents",
  diff: "Diff",
  planning: "Planning",
  implementing: "Implementing",
  export: "Export",
  review: "Review",
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
  if (issue.kind === "idea" || issue.kind === "epic") {
    return channelForIssue(issue);
  }
  return undefined;
}

/** Agents tab for Task and Story (once its parent is known) — kind-only, not data-dependent. */
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

/**
 * Page-level tab set for issue detail: Overview always; optional channel;
 * Export when a start has happened; Project keeps supporting-doc preview tabs.
 */
export function tabsForIssueDetail(
  issue: Issue,
  parentKind?: IssueKind,
  options?: { includeExport?: boolean },
): IssueDetailTab[] {
  const tabs: IssueDetailTab[] = [
    {
      key: DEFAULT_ISSUE_DETAIL_TAB,
      label: ISSUE_DETAIL_TAB_LABELS.overview,
    },
  ];
  const channel = channelTabForIssue(issue, parentKind);
  if (channel) {
    tabs.push({
      key: channel,
      label: ISSUE_DETAIL_TAB_LABELS[channel],
      channel,
    });
  }
  if (options?.includeExport) {
    tabs.push({
      key: "export",
      label: ISSUE_DETAIL_TAB_LABELS.export,
      channel: "export",
    });
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
  if (issue.kind === "project") {
    tabs.push(...previewableSupportingDocs(issue.supportingDocs));
  }
  return tabs;
}

function tabTitleSuffix(tab: IssueDetailTab): string | undefined {
  if (tab.key === DEFAULT_ISSUE_DETAIL_TAB) return undefined;
  if ("ref" in tab) return "Doc";
  return tab.label;
}

function isUnloadedSupportingDocKey(tabParam: string): boolean {
  return (SUPPORTING_DOC_KEYS as readonly string[]).includes(tabParam);
}

function suffixForUnloadedTabKey(tabParam: string): string | undefined {
  if (tabParam === DEFAULT_ISSUE_DETAIL_TAB) return undefined;
  if (isUnloadedSupportingDocKey(tabParam)) return "Doc";
  if (Object.hasOwn(ISSUE_DETAIL_TAB_LABELS, tabParam)) {
    return ISSUE_DETAIL_TAB_LABELS[
      tabParam as keyof typeof ISSUE_DETAIL_TAB_LABELS
    ];
  }
  return undefined;
}

/**
 * Suffix for the issue-detail tab title. Overview has none. A supporting-doc
 * preview uses `Doc`; every other eligible tab uses its label. Without
 * `tabs`, only static tab keys and supporting-doc keys produce a suffix.
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

/** Parse `tab` query value against the eligible set; unknown/ineligible → overview. */
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
 * Export keeps Overview / Implementing / Export visible while the draft list
 * is closed; an open mobile draft reader clears the tab bar separately via
 * `exportDraftReaderOpen`.
 */
export function mobileChannelChromeForTab(
  isMobile: boolean,
  active: IssueDetailTabKey,
  tabs: readonly IssueDetailTab[],
): boolean {
  return (
    isMobile &&
    active !== "export" &&
    issueDetailTabNeedsBoundedShell(active, tabs)
  );
}

/** Planning tab shows awaiting-human when the Idea awaits approval. */
export function channelTabIndicatorFromIdeaStatus(
  issue: Issue,
  channel: ConversationChannel,
  ideaStatus: IdeaStatus | undefined,
): ChannelTabIndicator | null {
  if (
    issue.kind === "idea" &&
    channel === "planning" &&
    ideaStatus === "awaiting-approval"
  ) {
    return "awaiting-human";
  }
  return null;
}

/** Merge session decoration with idea-status decoration; active-run wins. */
export function mergeChannelTabIndicators(
  session: ChannelTabIndicator | null,
  fromIdeaStatus: ChannelTabIndicator | null,
): ChannelTabIndicator | null {
  if (session === "active-run") return "active-run";
  if (session === "awaiting-human" || fromIdeaStatus === "awaiting-human") {
    return "awaiting-human";
  }
  return null;
}

/** Resolve channel tab decoration for issue detail. */
export function resolveChannelTabIndicator(
  issue: Issue,
  channel: ConversationChannel,
  ideaStatus: IdeaStatus | undefined,
  sessionIndicator: ChannelTabIndicator | null,
): ChannelTabIndicator | null {
  return mergeChannelTabIndicators(
    sessionIndicator,
    channelTabIndicatorFromIdeaStatus(issue, channel, ideaStatus),
  );
}
