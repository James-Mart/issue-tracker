import type { ReviewSubmission } from "@server/schemas";

export type ReviewWorkbenchTab = "conversation" | "commits" | "diff" | "standards";

type WorkbenchTabEntry = { key: ReviewWorkbenchTab; label: string };

export const REVIEW_WORKBENCH_TABS: WorkbenchTabEntry[] = [
  { key: "conversation", label: "Conversation" },
  { key: "commits", label: "Commits" },
  { key: "diff", label: "Diff" },
];

const STANDARDS_TAB: WorkbenchTabEntry = { key: "standards", label: "Standards" };

export const DEFAULT_REVIEW_WORKBENCH_TAB: ReviewWorkbenchTab = "conversation";

/** Standards joins the tabs once any submission carries a standards assessment. */
export function reviewWorkbenchTabs(
  submissions: readonly Pick<ReviewSubmission, "standards">[],
): WorkbenchTabEntry[] {
  return submissions.some((submission) => submission.standards !== undefined)
    ? [...REVIEW_WORKBENCH_TABS, STANDARDS_TAB]
    : REVIEW_WORKBENCH_TABS;
}

export function resolveReviewWorkbenchTab(
  raw: string | null,
  tabs: readonly Pick<WorkbenchTabEntry, "key">[] = REVIEW_WORKBENCH_TABS,
): ReviewWorkbenchTab {
  return tabs.find((tab) => tab.key === raw)?.key ?? DEFAULT_REVIEW_WORKBENCH_TAB;
}
