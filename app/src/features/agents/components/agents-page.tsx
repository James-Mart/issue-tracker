import { PageShell } from "@/components/page-shell";
import { ShellState } from "@/app/shell-state";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils/cn";
import { useAgentsUiStore } from "../store/use-agents-ui-store";
import { ConversationListSidebar } from "./conversation-list-sidebar";
import { ConversationThread } from "./conversation-thread";
import { CreateConversationDialog } from "./create-conversation-dialog";
import { DeleteConversationDialog } from "./delete-conversation-dialog";

const AGENTS_PAGE_SHELL_CLASS = "max-w-6xl gap-4 py-6";

function AgentsHeader() {
  return (
    <header>
      <p className="font-display text-[11px] font-semibold uppercase tracking-[0.22em] text-[hsl(var(--current))]">
        Agents
      </p>
    </header>
  );
}

function AgentsPane({
  title,
  children,
  className,
  showHeader = true,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
  /** When false, the child owns the pane header (open thread). */
  showHeader?: boolean;
}) {
  return (
    <section
      className={cn(
        "flex min-h-0 min-w-0 flex-col bg-card",
        className,
      )}
      aria-label={title}
    >
      {showHeader ? (
        <div className="shrink-0 border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-medium text-foreground">{title}</h2>
          </div>
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {children}
      </div>
    </section>
  );
}

/** Glass-style two-pane agents surface: conversation list + thread. */
export function AgentsPage() {
  const selectedConversationId = useAgentsUiStore(
    (s) => s.selectedConversationId,
  );
  const setSelectedConversationId = useAgentsUiStore(
    (s) => s.setSelectedConversationId,
  );
  const isMobile = useIsMobile();

  const conversationsPane = (
    <AgentsPane
      title="Conversations"
      className={
        isMobile ? "flex-1" : "w-72 shrink-0 border-r border-border"
      }
    >
      <ConversationListSidebar />
    </AgentsPane>
  );

  const threadPane = (
    <AgentsPane
      title="Thread"
      className="flex-1"
      showHeader={!selectedConversationId}
    >
      {selectedConversationId ? (
        <ConversationThread
          key={selectedConversationId}
          conversationId={selectedConversationId}
          onBack={
            isMobile ? () => setSelectedConversationId(null) : undefined
          }
        />
      ) : (
        <ShellState
          className="m-4 border-0 bg-transparent px-4 py-8 shadow-none"
          eyebrow="Idle"
          title="Select a conversation."
          detail="Choose a conversation from the list to view its transcript."
        />
      )}
    </AgentsPane>
  );

  return (
    <PageShell
      className={cn(
        AGENTS_PAGE_SHELL_CLASS,
        // Bound height so the thread scrolls and the composer stays pinned.
        "h-[calc(100svh-3rem)] min-h-0 overflow-hidden",
      )}
    >
      <AgentsHeader />
      <div
        className="flex min-h-0 flex-1 overflow-hidden rounded-lg border border-border"
        data-region="agents-window"
      >
        {isMobile ? (
          selectedConversationId ? threadPane : conversationsPane
        ) : (
          <>
            {conversationsPane}
            {threadPane}
          </>
        )}
      </div>
      <CreateConversationDialog />
      <DeleteConversationDialog />
    </PageShell>
  );
}
