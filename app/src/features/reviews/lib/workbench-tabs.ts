import type { ReviewSubmission } from "@server/schemas";

export type ReviewWorkbenchTab =
  | "conversation"
  | "commits"
  | "diff"
  | "standards"
  | "agents";

type WorkbenchTabEntry = { key: ReviewWorkbenchTab; label: string };

export const REVIEW_WORKBENCH_TABS: WorkbenchTabEntry[] = [
  { key: "conversation", label: "Conversation" },
  { key: "commits", label: "Commits" },
  { key: "diff", label: "Diff" },
];

const STANDARDS_TAB: WorkbenchTabEntry = { key: "standards", label: "Standards" };
const AGENTS_TAB: WorkbenchTabEntry = { key: "agents", label: "Agents" };

export const DEFAULT_REVIEW_WORKBENCH_TAB: ReviewWorkbenchTab = "conversation";

/**
 * Standards joins once any submission carries an assessment. Agents is always
 * last, including when Standards is absent.
 */
export function reviewWorkbenchTabs(
  submissions: readonly Pick<ReviewSubmission, "standards">[],
): WorkbenchTabEntry[] {
  const tabs = submissions.some((submission) => submission.standards !== undefined)
    ? [...REVIEW_WORKBENCH_TABS, STANDARDS_TAB]
    : REVIEW_WORKBENCH_TABS;
  return [...tabs, AGENTS_TAB];
}

export function resolveReviewWorkbenchTab(
  raw: string | null,
  tabs: readonly Pick<WorkbenchTabEntry, "key">[] = REVIEW_WORKBENCH_TABS,
): ReviewWorkbenchTab {
  return tabs.find((tab) => tab.key === raw)?.key ?? DEFAULT_REVIEW_WORKBENCH_TAB;
}
