import { type ReactNode } from "react";
import { History } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils/cn";

/** Shown in the Radix tooltip and as `aria-label` on the controls below. */
export const CHANGED_SINCE_REVIEWED_LABEL = "Changes since reviewed";

function ChangesSinceReviewedTooltip({ children }: { children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>{CHANGED_SINCE_REVIEWED_LABEL}</TooltipContent>
    </Tooltip>
  );
}

function ChangedSinceReviewedDot() {
  return (
    <ChangesSinceReviewedTooltip>
      <span
        className="inline-block h-2 w-2 shrink-0 rounded-full border border-[hsl(var(--warn))] bg-[hsl(var(--void))] shell:hidden"
        data-testid="review-changed-since-dot"
        aria-label={CHANGED_SINCE_REVIEWED_LABEL}
      />
    </ChangesSinceReviewedTooltip>
  );
}

export function ChangedSinceReviewedBadge({ className }: { className?: string }) {
  return (
    <ChangesSinceReviewedTooltip>
      <span
        className="inline-flex shrink-0 cursor-default rounded-md"
        data-testid="review-changed-since-badge"
        aria-label={CHANGED_SINCE_REVIEWED_LABEL}
        onClick={(event) => event.stopPropagation()}
      >
        <Badge variant="warn" className={cn("inline-flex shrink-0 px-1 py-0", className)}>
          <History className="h-3 w-3" aria-hidden="true" />
        </Badge>
      </span>
    </ChangesSinceReviewedTooltip>
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
