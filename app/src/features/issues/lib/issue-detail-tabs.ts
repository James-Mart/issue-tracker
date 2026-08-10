import { channelForIssue } from "@server/kind";
import type { ConversationChannel, Issue, IssueKind } from "@server/schemas";
import {
  previewableSupportingDocs,
  type SupportingDocPreviewTab,
} from "./supporting-docs";

export const DEFAULT_ISSUE_DETAIL_TAB = "overview" as const;

export type IssueDetailTabKey =
  | typeof DEFAULT_ISSUE_DETAIL_TAB
  | ConversationChannel
  | SupportingDocPreviewTab["key"];

export type IssueDetailTab =
  | { key: typeof DEFAULT_ISSUE_DETAIL_TAB; label: "Overview" }
  | { key: ConversationChannel; label: string; channel: ConversationChannel }
  | SupportingDocPreviewTab;

const CHANNEL_TAB_LABELS: Record<ConversationChannel, string> = {
  planning: "Planning",
  implementing: "Implementing",
};

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

/**
 * Page-level tab set for issue detail: Overview always; optional channel;
 * Project keeps supporting-doc preview tabs.
 */
export function tabsForIssueDetail(
  issue: Issue,
  parentKind?: IssueKind,
): IssueDetailTab[] {
  const tabs: IssueDetailTab[] = [
    { key: DEFAULT_ISSUE_DETAIL_TAB, label: "Overview" },
  ];
  const channel = channelTabForIssue(issue, parentKind);
  if (channel) {
    tabs.push({
      key: channel,
      label: CHANNEL_TAB_LABELS[channel],
      channel,
    });
  }
  if (issue.kind === "project") {
    tabs.push(...previewableSupportingDocs(issue.supportingDocs));
  }
  return tabs;
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
