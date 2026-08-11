import { useState, type ReactNode } from "react";
import { Trash2 } from "lucide-react";
import type { ChannelSessionListItem, ConversationChannel } from "@server/schemas";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils/cn";
import {
  formatChannelSessionSwitcherLabel,
  orderChannelSessionsForSwitcher,
} from "../api/channel-sessions";
import { useDeleteChannelSession } from "../api/mutations";

export function ChannelSessionSwitcher({
  issueId,
  channel,
  sessions,
  selectedId,
  onSelectedIdChange,
  trailing,
  className,
}: {
  issueId: string;
  channel: ConversationChannel;
  sessions: readonly ChannelSessionListItem[];
  selectedId: string;
  onSelectedIdChange: (id: string) => void;
  /** Extra controls aligned to the header row (e.g. New run). */
  trailing?: ReactNode;
  className?: string;
}) {
  const ordered = orderChannelSessionsForSwitcher(sessions);
  const selected = sessions.find((session) => session.id === selectedId);
  const deleteSession = useDeleteChannelSession(issueId, channel);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const confirmDelete = () => {
    deleteSession.mutate(selectedId, {
      onSuccess: () => {
        setDeleteOpen(false);
        const remaining = sessions.filter((session) => session.id !== selectedId);
        const next = orderChannelSessionsForSwitcher(remaining)[0];
        if (next) onSelectedIdChange(next.id);
      },
    });
  };

  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-2 border-b border-border px-4 py-2",
        className,
      )}
      data-testid="channel-session-switcher"
    >
      <Select value={selectedId} onValueChange={onSelectedIdChange}>
        <SelectTrigger
          className="h-8 min-w-0 flex-1 font-mono text-xs"
          aria-label="Channel session"
          data-testid="channel-session-select"
        >
          <SelectValue>
            {selected
              ? formatChannelSessionSwitcherLabel(selected)
              : "Select session"}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {ordered.map((session) => (
            <SelectItem key={session.id} value={session.id}>
              {formatChannelSessionSwitcherLabel(session)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="shrink-0 text-muted-foreground hover:text-destructive"
        title="Delete session"
        aria-label="Delete session"
        data-testid="channel-session-delete"
        onClick={() => setDeleteOpen(true)}
        disabled={deleteSession.isPending}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
      {trailing}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent data-testid="delete-channel-session-dialog">
          <DialogHeader>
            <DialogTitle>Delete session</DialogTitle>
            <DialogDescription>
              Permanently remove this{" "}
              {selected?.archived ? "archived " : ""}session
              {selected ? (
                <>
                  {" "}
                  started{" "}
                  <span className="text-foreground">
                    {formatChannelSessionSwitcherLabel(selected)}
                  </span>
                </>
              ) : null}
              ? Its transcript cannot be recovered.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={confirmDelete}
              disabled={deleteSession.isPending}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
