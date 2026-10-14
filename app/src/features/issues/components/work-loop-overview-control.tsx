import type { ChannelSessionListItem } from "@server/schemas";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";
import { formatRelativeUpdatedAt } from "../lib/format-relative-updated-at";

function sessionRefLine(session: ChannelSessionListItem): string {
  return `${session.id} · ${session.title} · ${formatRelativeUpdatedAt(session.updatedAt)}`;
}

/** Post-rail card for resuming a slot-holding implementing coordinator. */
export function WorkLoopOverviewControl({
  session,
  actionTestId,
  disabled,
  pending,
  onAction,
  className,
}: {
  session: ChannelSessionListItem;
  actionTestId: string;
  disabled?: boolean;
  pending?: boolean;
  onAction: () => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-lg border border-border bg-card px-3.5 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4",
        className,
      )}
      data-testid="post-rail-work-loop"
      data-mode="resume"
    >
      <div className="min-w-0 space-y-1">
        <p className="text-sm text-muted-foreground">
          Coordinator paused — pick up where it left off.
        </p>
        <p
          className="truncate font-mono text-[11px] tabular-nums text-muted-foreground"
          data-testid="work-loop-session-ref"
        >
          {sessionRefLine(session)}
        </p>
      </div>
      <Button
        type="button"
        variant="primary"
        size="sm"
        className="shrink-0 self-start sm:self-center"
        disabled={disabled}
        data-testid={actionTestId}
        onClick={onAction}
      >
        {pending ? "Resuming…" : "Resume work loop"}
      </Button>
    </div>
  );
}
