import { KIND_LABEL } from "@server/kind";
import { planDeletion } from "@server/services/deletion";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useDeleteIssue } from "../api/mutations";
import { useIssuesQuery } from "../api/queries";
import { useIssueUiStore } from "../store/use-issue-ui-store";

function deleteButtonLabel(deleteCount: number): string {
  return deleteCount > 1 ? `Delete ${deleteCount} issues` : "Delete";
}

export function DeleteIssueDialog() {
  const targetId = useIssueUiStore((s) => s.deleteTarget);
  const clearDelete = useIssueUiStore((s) => s.clearDelete);
  const deleteIssue = useDeleteIssue();
  const { data } = useIssuesQuery();

  const target =
    targetId && data
      ? data.issues.find((issue) => issue.id === targetId)
      : undefined;
  const plan =
    targetId && data ? planDeletion(data.issues, targetId) : undefined;
  const deleteCount = plan?.deleteIds.length ?? 1;
  const containedCount = deleteCount > 1 ? deleteCount - 1 : 0;
  const kindLabel = target ? KIND_LABEL[target.kind].toLowerCase() : "issue";

  const confirm = () => {
    if (!targetId) return;
    deleteIssue.mutate(targetId, { onSuccess: () => clearDelete() });
  };

  return (
    <Dialog
      open={Boolean(targetId)}
      onOpenChange={(open) => !open && clearDelete()}
    >
      <DialogContent data-testid="delete-issue-dialog">
        <DialogHeader>
          <DialogTitle>Delete {kindLabel}</DialogTitle>
          <DialogDescription>
            Permanently remove{" "}
            {target?.title ? (
              <span className="text-foreground">{target.title}</span>
            ) : (
              <span className="font-mono">{targetId}</span>
            )}
            {target?.title ? (
              <>
                {" "}
                <span className="font-mono">({targetId})</span>
              </>
            ) : null}
            {containedCount > 0 ? (
              <>
                {" "}
                and {containedCount} contained issue
                {containedCount === 1 ? "" : "s"}
              </>
            ) : null}
            ?
          </DialogDescription>
        </DialogHeader>
        {plan && (plan.repoint.length > 0 || plan.unblock.length > 0) ? (
          <ul className="space-y-1 text-sm text-muted-foreground">
            {plan.repoint.length > 0 ? (
              <li>
                Repoints {plan.repoint.length} branch
                {plan.repoint.length === 1 ? "" : "es"} to a new fork point.
              </li>
            ) : null}
            {plan.unblock.length > 0 ? (
              <li>
                Drops this from {plan.unblock.length} branch
                {plan.unblock.length === 1 ? "'s" : "es'"} blocked-by list.
              </li>
            ) : null}
          </ul>
        ) : null}
        <DialogFooter>
          <Button variant="ghost" onClick={() => clearDelete()}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={confirm}
            disabled={deleteIssue.isPending}
          >
            {deleteButtonLabel(deleteCount)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
