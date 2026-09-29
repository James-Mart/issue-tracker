export type ReviewWorkbenchTab = "diff";

export const REVIEW_WORKBENCH_TABS: { key: ReviewWorkbenchTab; label: string }[] = [
  { key: "diff", label: "Diff" },
];

export const DEFAULT_REVIEW_WORKBENCH_TAB: ReviewWorkbenchTab = "diff";

export function resolveReviewWorkbenchTab(raw: string | null): ReviewWorkbenchTab {
  return REVIEW_WORKBENCH_TABS.find((tab) => tab.key === raw)?.key ??
    DEFAULT_REVIEW_WORKBENCH_TAB;
}
