import { useEffect, useState } from "react";
import type { IssueDetail } from "@server/schemas";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils/cn";
import type { StartedChannelSession } from "../api/channel-sessions";
import { useStartOutlinePlanningSession } from "../api/mutations";

type OutlineDetail = Extract<IssueDetail, { kind: "outline" }>;

/**
 * Brief dialog for a new planner session. `researchStory` is sent with the
 * start so the opening message names that Story. Without `bodyVersion` the
 * dialog shows `unavailable` instead of the brief.
 */
export function NewPlanningSessionDialog({
  outlineId,
  bodyVersion,
  unavailable,
  open,
  onOpenChange,
  onStarted,
  researchStory,
}: {
  outlineId: string;
  bodyVersion?: number;
  /** Shown in place of the brief until the outline version is known. */
  unavailable?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStarted: (session: StartedChannelSession) => void;
  researchStory?: string;
}) {
  const [brief, setBrief] = useState("");
  const start = useStartOutlinePlanningSession(outlineId);
  const trimmed = brief.trim();
  const ready = bodyVersion !== undefined;

  useEffect(() => {
    if (open) setBrief("");
  }, [open]);

  const submit = () => {
    if (!ready) return;
    start.mutate(
      { brief: trimmed, ...(researchStory ? { researchStory } : {}) },
      {
        onSuccess: (session) => {
          onOpenChange(false);
          onStarted(session);
        },
      },
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (start.isPending && !next) return;
        onOpenChange(next);
      }}
    >
      <DialogContent
        data-testid="outline-new-planning-session-dialog"
        className="flex max-h-[min(calc(100dvh-2rem),40rem)] flex-col overflow-hidden"
      >
        <DialogHeader className="shrink-0">
          <DialogTitle>New planning session</DialogTitle>
          <DialogDescription>
            {ready
              ? `Archives the current planner conversation (it stays in the session picker as read-only). The revision brief is seeded from outline v${bodyVersion}.`
              : unavailable}
          </DialogDescription>
        </DialogHeader>
        {ready ? (
          <div
            data-testid="outline-new-planning-session-body"
            className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto overscroll-y-contain"
          >
            <label
              htmlFor={`outline-new-planning-brief-${outlineId}`}
              className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground"
            >
              Revision brief
            </label>
            <Textarea
              id={`outline-new-planning-brief-${outlineId}`}
              data-testid="outline-new-planning-brief"
              value={brief}
              disabled={start.isPending}
              onChange={(event) => setBrief(event.target.value)}
            />
          </div>
        ) : null}
        <DialogFooter className="shrink-0">
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={start.isPending}
          >
            Cancel
          </Button>
          {ready ? (
            <Button
              type="button"
              variant="current"
              data-testid="outline-new-planning-session-start"
              disabled={!trimmed || start.isPending}
              onClick={submit}
            >
              Start session
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * New planning session on an outline. The title stays outside the scrolling
 * brief so a short phone viewport does not push it off screen.
 */
export function OutlineNewPlanningSessionControl({
  outline,
  onStarted,
  disabled = false,
  className,
}: {
  outline: OutlineDetail;
  onStarted: (session: StartedChannelSession) => void;
  /** Another outline channel already has the one live run. */
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        type="button"
        variant="outline"
        className={cn("w-full", className)}
        data-testid="outline-new-planning-session"
        disabled={disabled}
        title={
          disabled
            ? "Unavailable while the other channel has a live run."
            : undefined
        }
        onClick={() => setOpen(true)}
      >
        New planning session
      </Button>
      <NewPlanningSessionDialog
        outlineId={outline.id}
        bodyVersion={outline.bodyVersion}
        open={open}
        onOpenChange={setOpen}
        onStarted={onStarted}
      />
    </>
  );
}
