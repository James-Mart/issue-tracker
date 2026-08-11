import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CommitShaDisplay } from "./readonly-git-fields";

/** Confirm-then-act dialog for landing a Story PR at a pinned head commit. */
export function MergePrDialog({
  open,
  headRefOid,
  auto,
  confirming,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  headRefOid: string;
  auto: boolean;
  confirming?: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="merge-pr-dialog">
        <DialogHeader>
          <DialogTitle>
            {auto ? "Enable auto-merge?" : "Merge pull request?"}
          </DialogTitle>
          <DialogDescription>
            {auto ? (
              <>
                Auto-merge will land head{" "}
                <CommitShaDisplay commitSha={headRefOid} /> when checks pass.
              </>
            ) : (
              <>
                This will create a merge commit for head{" "}
                <CommitShaDisplay commitSha={headRefOid} />.
              </>
            )}
          </DialogDescription>
        </DialogHeader>
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
            onClick={onConfirm}
            disabled={confirming}
            data-testid="merge-pr-confirm"
          >
            {confirming
              ? "Working…"
              : auto
                ? "Enable auto-merge"
                : "Merge"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
