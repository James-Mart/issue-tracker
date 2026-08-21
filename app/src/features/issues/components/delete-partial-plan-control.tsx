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
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
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

function DeletePartialPlanControl({
  issue,
  variant,
}: {
  issue: IdeaDetail;
  variant: "icon" | "menuItem";
}) {
  const deletePartialPlan = useDeletePartialPlan(issue.id);
  const [open, setOpen] = useState(false);
  const label = "Delete partial plan";

  if (variant === "icon") {
    return (
      <>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          title={label}
          aria-label={label}
          data-testid="flow-row-delete-partial-plan"
          className="text-muted-foreground hover:text-destructive"
          disabled={deletePartialPlan.isPending}
          onClick={() => setOpen(true)}
        >
          <Trash2 className="h-3.5 w-3.5" />
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

  return (
    <>
      <DropdownMenuItem
        disabled={deletePartialPlan.isPending}
        data-testid="flow-row-delete-partial-plan-menu"
        onSelect={(event) => {
          event.preventDefault();
          setOpen(true);
        }}
      >
        <Trash2 className="h-4 w-4" />
        {deletePartialPlan.isPending ? "Deleting…" : label}
      </DropdownMenuItem>
      <DeletePartialPlanDialog
        issue={issue}
        open={open}
        onOpenChange={setOpen}
        deletePartialPlan={deletePartialPlan}
      />
    </>
  );
}

/** Icon-only delete-partial-plan action for Flow row steering. */
export function DeletePartialPlanFlowRowAction({ issue }: { issue: IdeaDetail }) {
  return <DeletePartialPlanControl issue={issue} variant="icon" />;
}

/** Touch overflow menu item for the same delete-partial-plan path. */
export function DeletePartialPlanFlowRowTouchMenu({ issue }: { issue: IdeaDetail }) {
  return <DeletePartialPlanControl issue={issue} variant="menuItem" />;
}
