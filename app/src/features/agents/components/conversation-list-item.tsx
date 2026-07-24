import { useEffect, useRef, useState } from "react";
import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import type { ConversationMeta } from "@server/schemas";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils/cn";
import { useUpdateConversation } from "../api/mutations";
import { useAgentsUiStore } from "../store/use-agents-ui-store";

export function ConversationListItem({
  conversation,
  projectTitle,
  isSelected,
  onSelect,
}: {
  conversation: ConversationMeta;
  projectTitle: string;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const renamingId = useAgentsUiStore((s) => s.renamingId);
  const startRename = useAgentsUiStore((s) => s.startRename);
  const clearRename = useAgentsUiStore((s) => s.clearRename);
  const requestDelete = useAgentsUiStore((s) => s.requestDelete);
  const updateConversation = useUpdateConversation();

  const isRenaming = renamingId === conversation.id;
  const [draft, setDraft] = useState(conversation.title);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isRenaming) {
      setDraft(conversation.title);
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isRenaming, conversation.title]);

  const commitRename = () => {
    const trimmed = draft.trim();
    if (!trimmed || trimmed === conversation.title) {
      clearRename();
      return;
    }
    updateConversation.mutate(
      { id: conversation.id, patch: { title: trimmed } },
      { onSettled: () => clearRename() },
    );
  };

  return (
    <div
      className={cn(
        "group flex items-center gap-1 border-b border-border px-2 py-1",
        isSelected && "bg-accent/40",
      )}
    >
      {isRenaming ? (
        <form
          className="min-w-0 flex-1"
          onSubmit={(event) => {
            event.preventDefault();
            commitRename();
          }}
        >
          <Input
            ref={inputRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commitRename}
            onKeyDown={(event) => {
              if (event.key === "Escape") clearRename();
            }}
            className="h-8"
            disabled={updateConversation.isPending}
            aria-label="Conversation title"
          />
        </form>
      ) : (
        <button
          type="button"
          onClick={onSelect}
          className={cn(
            "min-w-0 flex-1 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent/60",
            isSelected && "hover:bg-accent/60",
          )}
        >
          <span className="block truncate text-sm font-medium text-foreground">
            {conversation.title}
          </span>
          <span className="block truncate font-mono text-[11px] text-muted-foreground">
            {projectTitle} · {conversation.model}
          </span>
        </button>
      )}

      {!isRenaming ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 focus-within:opacity-100 data-[state=open]:opacity-100"
              title="Conversation actions"
              onClick={(event) => event.stopPropagation()}
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => startRename(conversation.id)}>
              <Pencil className="h-4 w-4" />
              Rename
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={() => requestDelete(conversation.id)}
            >
              <Trash2 className="h-4 w-4" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}
