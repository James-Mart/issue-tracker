import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useDeleteConversation } from "../api/mutations";
import { useConversationsQuery } from "../api/queries";
import { useAgentsUiStore } from "../store/use-agents-ui-store";

export function DeleteConversationDialog() {
  const targetId = useAgentsUiStore((s) => s.deleteTargetId);
  const clearDelete = useAgentsUiStore((s) => s.clearDelete);
  const selectedConversationId = useAgentsUiStore(
    (s) => s.selectedConversationId,
  );
  const setSelectedConversationId = useAgentsUiStore(
    (s) => s.setSelectedConversationId,
  );
  const deleteConversation = useDeleteConversation();
  const { data } = useConversationsQuery(true);

  const target = targetId
    ? data?.find((conversation) => conversation.id === targetId)
    : undefined;

  const confirm = () => {
    if (!targetId) return;
    deleteConversation.mutate(targetId, {
      onSuccess: () => {
        if (selectedConversationId === targetId) {
          setSelectedConversationId(null);
        }
        clearDelete();
      },
    });
  };

  return (
    <Dialog
      open={Boolean(targetId)}
      onOpenChange={(open) => !open && clearDelete()}
    >
      <DialogContent data-testid="delete-conversation-dialog">
        <DialogHeader>
          <DialogTitle>Delete conversation</DialogTitle>
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
            ? Its transcript cannot be recovered.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => clearDelete()}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={confirm}
            disabled={deleteConversation.isPending}
          >
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
