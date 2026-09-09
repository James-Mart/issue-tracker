import { useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/** Confirm-then-act dialog before appending the merge-base update Task. */
export function MergeBaseConfirmDialog({
  open,
  mergeBase,
  branchName,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  mergeBase: string;
  branchName: string;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="merge-base-confirm-dialog"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          confirmRef.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>Update from merge base?</DialogTitle>
          <DialogDescription>
            This adds one predefined Task at the end of the Story sequence. An
            agent will merge{" "}
            <span className="font-mono text-foreground">{mergeBase}</span> into{" "}
            <span className="font-mono text-foreground">{branchName}</span> and
            resolve conflicts.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            ref={confirmRef}
            type="button"
            variant="current"
            onClick={onConfirm}
            data-testid="merge-base-confirm"
          >
            Update from merge base
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
