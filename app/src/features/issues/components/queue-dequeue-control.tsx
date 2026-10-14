import { Loader2, X } from "lucide-react";
import type { IssueRecord } from "@server/schemas";
import { Button } from "@/components/ui/button";
import { useDequeueWorkRoot } from "../api/mutations";

type WaitingWorkRoot = Extract<IssueRecord, { kind: "epic" | "story" }>;

/** Icon-only dequeue for a waiting queue row. */
export function QueueDequeueControl({ issue }: { issue: WaitingWorkRoot }) {
  const dequeue = useDequeueWorkRoot(issue.id);
  const busy = dequeue.isPending;

  return (
    <Button
      type="button"
      variant="default"
      size="icon-sm"
      title={busy ? "Dequeuing" : "Dequeue"}
      aria-label={busy ? "Dequeuing" : "Dequeue"}
      aria-busy={busy || undefined}
      data-testid={busy ? "flow-row-dequeue-pending" : "flow-row-dequeue"}
      disabled={busy}
      onClick={() => {
        if (busy) return;
        dequeue.mutate();
      }}
    >
      {busy ? (
        <Loader2 className="h-3.5 w-3.5 motion-safe:animate-spin" />
      ) : (
        <X className="h-3.5 w-3.5" />
      )}
    </Button>
  );
}
