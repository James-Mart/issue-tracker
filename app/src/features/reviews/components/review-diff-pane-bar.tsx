import { TabButton } from "@/components/ui/tab-button";
import type { ReviewDiffPane } from "../lib/review-diff-pane";

/**
 * Phone Files / Code control, pinned to the viewport. `shell:hidden` removes
 * it at the breakpoint where the diff stays side by side.
 */
export function ReviewDiffPaneBar({
  pane,
  onPaneChange,
}: {
  pane: ReviewDiffPane;
  onPaneChange: (pane: ReviewDiffPane) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Diff pane"
      data-testid="review-diff-pane-bar"
      className="fixed inset-x-0 bottom-0 z-30 flex border-t border-border bg-background pb-[env(safe-area-inset-bottom)] shell:hidden"
    >
      <TabButton
        id="review-diff-pane-files-tab"
        aria-controls="review-file-list"
        selected={pane === "files"}
        className="flex-1 justify-center"
        data-testid="review-diff-pane-files"
        onClick={() => onPaneChange("files")}
      >
        Files
      </TabButton>
      <TabButton
        id="review-diff-pane-code-tab"
        aria-controls="review-diff-code"
        selected={pane === "code"}
        className="flex-1 justify-center"
        data-testid="review-diff-pane-code"
        onClick={() => onPaneChange("code")}
      >
        Code
      </TabButton>
    </div>
  );
}
