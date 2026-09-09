import type { ChannelSessionListItem } from "@server/schemas";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";
import { formatRelativeUpdatedAt } from "../lib/format-relative-updated-at";
import { implementingLaunchCopy } from "../lib/implementing-launch";

export type WorkLoopOverviewMode = "start" | "resume";

export function workLoopOverviewCopy(mode: WorkLoopOverviewMode): {
  actionLabel: string;
  detail: string;
} {
  if (mode === "start") {
    return {
      actionLabel: implementingLaunchCopy().actionLabel,
      detail: "Outstanding work remains — start coordinating from here.",
    };
  }
  return {
    actionLabel: "Resume work loop",
    detail: "Coordinator paused — pick up where it left off.",
  };
}

function sessionRefLine(session: ChannelSessionListItem): string {
  return `${session.id} · ${session.title} · ${formatRelativeUpdatedAt(session.updatedAt)}`;
}

/** Post-rail card for starting or resuming the implementing work loop. */
export function WorkLoopOverviewControl({
  mode,
  session,
  actionTestId,
  disabled,
  pending,
  onAction,
  className,
}: {
  mode: WorkLoopOverviewMode;
  session?: ChannelSessionListItem;
  actionTestId: string;
  disabled?: boolean;
  pending?: boolean;
  onAction: () => void;
  className?: string;
}) {
  const copy = workLoopOverviewCopy(mode);

  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-lg border border-border bg-card px-3.5 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4",
        className,
      )}
      data-testid="post-rail-work-loop"
      data-mode={mode}
    >
      <div className="min-w-0 space-y-1">
        <p className="text-sm text-muted-foreground">{copy.detail}</p>
        {mode === "resume" && session ? (
          <p
            className="truncate font-mono text-[11px] tabular-nums text-muted-foreground"
            data-testid="work-loop-session-ref"
          >
            {sessionRefLine(session)}
          </p>
        ) : null}
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
        {pending
          ? mode === "start"
            ? "Starting…"
            : "Resuming…"
          : copy.actionLabel}
      </Button>
    </div>
  );
}
