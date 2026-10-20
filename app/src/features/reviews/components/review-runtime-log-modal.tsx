import { useEffect, useRef } from "react";
import type { ReviewRuntimeLog, RuntimeBootPhase } from "@server/schemas";
import { scrollToBottom } from "@/components/ui/message-scroller";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  bootingPhaseModalTitle,
  failedPhaseModalTitle,
} from "../lib/runtime-boot-phase";

export function ReviewRuntimeLogModal({
  open,
  onOpenChange,
  phase,
  failed,
  log,
  loading,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  phase: RuntimeBootPhase | undefined;
  failed: boolean;
  log: ReviewRuntimeLog | undefined;
  loading: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const displayPhase = log?.phase ?? phase;
  const title =
    displayPhase === undefined
      ? "Boot log"
      : failed
        ? failedPhaseModalTitle(displayPhase)
        : bootingPhaseModalTitle(displayPhase);
  const logName = log?.log;

  useEffect(() => {
    if (!open) return;
    const node = scrollRef.current;
    if (!node) return;
    scrollToBottom(node);
  }, [open, log?.lines]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[min(85vh,720px)] flex-col gap-3 sm:max-w-lg"
        data-testid="review-runtime-log-modal"
      >
        <DialogHeader className="space-y-0.5 text-left">
          <DialogTitle>{title}</DialogTitle>
          {logName ? (
            <p className="font-mono text-xs text-muted-foreground">{logName}</p>
          ) : null}
        </DialogHeader>
        <div
          ref={scrollRef}
          className="min-h-0 flex-1 overflow-y-auto rounded-md border border-border bg-[hsl(var(--panel-2))] p-3"
          data-testid="review-runtime-log-body"
        >
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading log…</p>
          ) : log?.lines.length ? (
            <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-foreground">
              {log.lines.join("\n")}
            </pre>
          ) : (
            <p className="text-sm text-muted-foreground">No log lines yet.</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
