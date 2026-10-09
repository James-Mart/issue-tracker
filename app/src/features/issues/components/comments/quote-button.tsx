import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";

const AUTHOR_ACTION_CLASS =
  "h-6 gap-1 px-1.5 text-[11px] font-normal text-muted-foreground touch:h-11";

/** Right-aligned cluster on a comment's author line. */
export function AuthorActionRow({ children }: { children: ReactNode }) {
  return (
    <div className="ml-auto flex shrink-0 items-center gap-0.5">{children}</div>
  );
}

export function QuoteButton({
  onClick,
  compact = true,
}: {
  onClick: () => void;
  /** Author-line size. The collapsed bar passes false so Quote matches Unresolve and Reopen. */
  compact?: boolean;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={compact ? AUTHOR_ACTION_CLASS : undefined}
      data-testid="comment-quote"
      onClick={onClick}
    >
      Quote
    </Button>
  );
}

/** File and line caption above a quote composer. The field placeholder stays a short hint. */
export function QuoteComposerLabel({
  label,
  className,
}: {
  label: string;
  className?: string;
}) {
  return (
    <p
      data-testid="comment-quote-label"
      className={cn(
        "font-mono text-[11px] tabular-nums text-muted-foreground",
        className,
      )}
    >
      {label}
    </p>
  );
}

export { AUTHOR_ACTION_CLASS };
