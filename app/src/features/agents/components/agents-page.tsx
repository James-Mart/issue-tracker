import { PageShell } from "@/components/page-shell";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { ShellState } from "@/app/shell-state";
import { cn } from "@/lib/utils/cn";

const AGENTS_PAGE_SHELL_CLASS = "max-w-6xl gap-4 py-6";

function AgentsHeader() {
  return (
    <header className="flex items-center gap-2">
      <SidebarTrigger className="-ml-1" />
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
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "flex min-h-0 min-w-0 flex-col bg-card",
        className,
      )}
      aria-label={title}
    >
      <div className="shrink-0 border-b border-border px-4 py-3">
        <h2 className="text-sm font-medium text-foreground">{title}</h2>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {children}
      </div>
    </section>
  );
}

/** Glass-style two-pane agents surface: conversation list + thread. */
export function AgentsPage() {
  return (
    <PageShell
      className={cn(
        AGENTS_PAGE_SHELL_CLASS,
        "min-h-[calc(100svh-3rem)]",
      )}
    >
      <AgentsHeader />
      <div
        className="flex min-h-0 flex-1 overflow-hidden rounded-lg border border-border"
        data-region="agents-window"
      >
        <AgentsPane
          title="Conversations"
          className="w-72 shrink-0 border-r border-border"
        >
          <ShellState
            className="m-4 border-0 bg-transparent px-4 py-8 shadow-none"
            eyebrow="Empty"
            title="No conversations yet."
            detail="Start a new conversation to run an agent against a project workspace."
          />
        </AgentsPane>
        <AgentsPane title="Thread" className="flex-1">
          <ShellState
            className="m-4 border-0 bg-transparent px-4 py-8 shadow-none"
            eyebrow="Idle"
            title="Select a conversation."
            detail="Choose a conversation from the list to view its transcript."
          />
        </AgentsPane>
      </div>
    </PageShell>
  );
}
