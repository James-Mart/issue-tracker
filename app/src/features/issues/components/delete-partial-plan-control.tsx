import { useState } from "react";
import { Trash2 } from "lucide-react";
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
import { useDeletePartialPlan } from "../api/mutations";

type IdeaDetail = Extract<IssueDetail, { kind: "idea" }>;

function DeletePartialPlanDialog({
  issue,
  open,
  onOpenChange,
  deletePartialPlan,
}: {
  issue: IdeaDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deletePartialPlan: ReturnType<typeof useDeletePartialPlan>;
}) {
  const confirm = () => {
    deletePartialPlan.mutate(undefined, {
      onSuccess: () => onOpenChange(false),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="delete-partial-plan-dialog">
        <DialogHeader>
          <DialogTitle>Delete partial plan</DialogTitle>
          <DialogDescription>
            All planning sessions on{" "}
            <span className="text-foreground">{issue.title}</span> will be
            permanently removed and the Idea will return to Awaiting planning.
            Transcripts cannot be recovered.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={confirm}
            disabled={deletePartialPlan.isPending}
          >
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Labeled destructive delete-partial-plan action for the Idea detail overview. */
export function DeletePartialPlanDetailAction({ issue }: { issue: IdeaDetail }) {
  const deletePartialPlan = useDeletePartialPlan(issue.id);
  const [open, setOpen] = useState(false);
  const label = "Delete partial plan";

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="w-fit text-destructive"
        data-testid="idea-detail-delete-partial-plan"
        disabled={deletePartialPlan.isPending}
        onClick={() => setOpen(true)}
      >
        <Trash2 className="h-3.5 w-3.5" />
        {deletePartialPlan.isPending ? "Deleting…" : label}
      </Button>
      <DeletePartialPlanDialog
        issue={issue}
        open={open}
        onOpenChange={setOpen}
        deletePartialPlan={deletePartialPlan}
      />
    </>
  );
}
