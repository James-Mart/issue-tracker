import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";
import type { OlderEventsStatus } from "../lib/conversation-events-state";

// Every state keeps one height, and idle holds the space, so the loading and
// retry rows appear where the reader stopped without shifting the events.
const rowClass =
  "flex min-h-10 items-center justify-center gap-2 touch:min-h-11";

/** Top-of-thread slot while older events remain: idle, in flight, or failed with Retry. */
export function OlderEventsRow({
  status,
  onRetry,
}: {
  status: OlderEventsStatus;
  onRetry: () => void;
}) {
  if (status === "loading") {
    return (
      <div
        role="status"
        aria-live="polite"
        className={cn(rowClass, "font-mono text-[11px] text-muted-foreground")}
        data-testid="older-events-loading"
      >
        <Loader2 className="h-3.5 w-3.5 motion-safe:animate-spin" aria-hidden />
        Loading earlier events…
      </div>
    );
  }
  if (status === "error") {
    return (
      <div role="alert" className={rowClass} data-testid="older-events-failed">
        <span className="text-sm text-destructive">
          Couldn't load earlier events.
        </span>
        <Button
          variant="primary"
          size="sm"
          onClick={onRetry}
          data-testid="older-events-retry"
        >
          Retry
        </Button>
      </div>
    );
  }
  return <div className={rowClass} aria-hidden data-testid="older-events-idle" />;
}
