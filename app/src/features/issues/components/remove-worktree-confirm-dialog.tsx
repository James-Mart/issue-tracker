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

/** Confirm-then-act dialog before posting worktree remove. */
export function RemoveWorktreeConfirmDialog({
  open,
  path,
  description,
  confirming,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  path?: string;
  description: string;
  confirming?: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="remove-worktree-confirm-dialog"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          confirmRef.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>Remove worktree?</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {path ? (
          <code
            data-testid="remove-worktree-confirm-path"
            className="block min-w-0 truncate rounded-md border border-border bg-background px-3 py-2 font-mono text-[13px] tabular-nums"
          >
            {path}
          </code>
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
            ref={confirmRef}
            type="button"
            variant="destructive"
            onClick={onConfirm}
            disabled={confirming}
            data-testid="remove-worktree-confirm"
          >
            {confirming ? "Working…" : "Remove worktree"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
