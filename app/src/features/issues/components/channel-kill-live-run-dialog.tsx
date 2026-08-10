import type { ChannelSessionListItem } from "@server/schemas";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatChannelSessionSwitcherLabel } from "../api/channel-sessions";

/** Confirm before a channel action kills and archives a mid-run session. */
export function ChannelKillLiveRunDialog({
  open,
  session,
  confirming,
  error,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  session: ChannelSessionListItem | undefined;
  confirming?: boolean;
  error?: string | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="channel-kill-live-run-dialog">
        <DialogHeader>
          <DialogTitle>Kill live run?</DialogTitle>
          <DialogDescription>
            This will stop the agent and archive the session
            {session ? (
              <>
                {" "}
                started{" "}
                <span className="text-foreground">
                  {formatChannelSessionSwitcherLabel(session)}
                </span>
              </>
            ) : null}
            . You can still open it from the session switcher.
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <p className="text-sm text-destructive" data-testid="channel-kill-live-run-error">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={confirming}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={onConfirm}
            disabled={confirming || !session}
            data-testid="channel-kill-live-run-confirm"
          >
            {confirming ? "Working…" : "Kill and archive"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
