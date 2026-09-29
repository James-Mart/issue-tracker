import { History } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils/cn";

export const CHANGED_SINCE_REVIEWED_TITLE =
  "A newer commit changed this file after it was marked reviewed";

function ChangedSinceReviewedDot() {
  return (
    <span
      className="inline-block h-2 w-2 shrink-0 rounded-full border border-[hsl(var(--warn))] bg-[hsl(var(--void))] shell:hidden"
      data-testid="review-changed-since-dot"
      title={CHANGED_SINCE_REVIEWED_TITLE}
      aria-label={CHANGED_SINCE_REVIEWED_TITLE}
    />
  );
}

export function ChangedSinceReviewedBadge({ className }: { className?: string }) {
  return (
    <Badge
      variant="warn"
      className={cn("shrink-0 gap-1 px-1.5 py-0 font-mono font-medium", className)}
      data-testid="review-changed-since-badge"
      title={CHANGED_SINCE_REVIEWED_TITLE}
    >
      <History className="h-3 w-3" aria-hidden="true" />
      Changed since reviewed
    </Badge>
  );
}

/** Compact warn dot on phone; full badge from the shell breakpoint up. */
export function ChangedSinceReviewedHeaderMark() {
  return (
    <>
      <ChangedSinceReviewedDot />
      <ChangedSinceReviewedBadge className="hidden shell:inline-flex" />
    </>
  );
}
