import { Link } from "react-router-dom";
import { agentsConversationPath } from "@/features/agents/lib/links";

/** In-app handoff to this run's conversation in Agents chat. */
export function ReviewRunOpenInAgents({ conversationId }: { conversationId: string }) {
  return (
    <Link
      to={agentsConversationPath(conversationId)}
      className="inline-flex min-h-11 shrink-0 items-center px-3 text-[11px] font-medium text-[hsl(var(--current))] no-underline hover:underline hover:underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      data-testid="agent-run-open-in-agents"
    >
      Open in Agents
    </Link>
  );
}
