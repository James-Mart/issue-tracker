import { useMemo } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ShellInlineFault, ShellState } from "@/app/shell-state";
import { Skeleton } from "@/components/ui/skeleton";
import { useIssuesQuery } from "@/features/issues/api/queries";
import { issuesById } from "@/features/issues/lib/build-tree";
import { useConversationsQuery } from "../api/queries";
import { useAgentsUiStore } from "../store/use-agents-ui-store";
import { ConversationListItem } from "./conversation-list-item";

export function ConversationListSidebar() {
  const selectedConversationId = useAgentsUiStore(
    (s) => s.selectedConversationId,
  );
  const setSelectedConversationId = useAgentsUiStore(
    (s) => s.setSelectedConversationId,
  );
  const openCreateDialog = useAgentsUiStore((s) => s.openCreateDialog);
  const {
    data: conversations,
    isLoading,
    error,
    refetch,
    isFetching,
  } = useConversationsQuery();
  const { data: issuesData } = useIssuesQuery();

  const projectTitles = useMemo(() => {
    const byId = issuesById(issuesData?.issues ?? []);
    const titles = new Map<string, string>();
    for (const issue of byId.values()) {
      if (issue.kind === "project") titles.set(issue.id, issue.title);
    }
    return titles;
  }, [issuesData?.issues]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2">
        <p className="text-xs text-muted-foreground">
          {conversations?.length ?? 0} conversation
          {(conversations?.length ?? 0) === 1 ? "" : "s"}
        </p>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 px-2"
          onClick={() => openCreateDialog()}
        >
          <Plus className="h-3.5 w-3.5" />
          New
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="space-y-2 p-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : error ? (
          <div className="p-3">
            <ShellInlineFault
              message={error.message}
              hint="Check the server, then reload."
            />
            <Button
              variant="primary"
              size="sm"
              className="mt-3"
              disabled={isFetching}
              onClick={() => refetch()}
            >
              Reload
            </Button>
          </div>
        ) : conversations && conversations.length > 0 ? (
          <div role="list" aria-label="Conversations">
            {conversations.map((conversation) => (
              <ConversationListItem
                key={conversation.id}
                conversation={conversation}
                projectTitle={
                  projectTitles.get(conversation.projectId) ??
                  conversation.projectId
                }
                isSelected={selectedConversationId === conversation.id}
                onSelect={() => setSelectedConversationId(conversation.id)}
              />
            ))}
          </div>
        ) : (
          <ShellState
            className="m-3 border-0 bg-transparent px-2 py-8 shadow-none"
            eyebrow="Empty"
            title="No conversations yet."
            detail="Start a new conversation to run an agent against a project workspace."
            action={
              <Button variant="primary" size="sm" onClick={() => openCreateDialog()}>
                New conversation
              </Button>
            }
          />
        )}
      </div>
    </div>
  );
}
