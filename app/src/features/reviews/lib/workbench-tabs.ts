export type ReviewWorkbenchTab = "commits" | "diff";

export const REVIEW_WORKBENCH_TABS: { key: ReviewWorkbenchTab; label: string }[] = [
  { key: "commits", label: "Commits" },
  { key: "diff", label: "Diff" },
];

export const DEFAULT_REVIEW_WORKBENCH_TAB: ReviewWorkbenchTab = "commits";

export function resolveReviewWorkbenchTab(raw: string | null): ReviewWorkbenchTab {
  return REVIEW_WORKBENCH_TABS.find((tab) => tab.key === raw)?.key ??
    DEFAULT_REVIEW_WORKBENCH_TAB;
}
