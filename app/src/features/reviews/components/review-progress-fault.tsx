export const REVIEW_PROGRESS_FAULT_MESSAGE = "Could not load progress.";
export const REVIEW_PROGRESS_FAULT_HINT = "Reload the page.";

/** Row-level progress failure. Says what failed and the next move. */
export function ReviewProgressFault() {
  return (
    <p role="alert" className="mt-0.5 text-xs text-destructive">
      {REVIEW_PROGRESS_FAULT_MESSAGE} {REVIEW_PROGRESS_FAULT_HINT}
    </p>
  );
}
