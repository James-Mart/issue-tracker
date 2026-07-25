import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils/cn";
import type { SubAgent } from "../lib/subagent";
import { SubagentThread } from "./subagent-thread";
import {
  CollapsiblePayload,
  toolStatusVariant,
} from "./transcript-ui";

/** At-rest sub-agent card; falls back to a standalone card when `steps` is empty. */
export function SubagentCard({ agent }: { agent: SubAgent }) {
  const hasSteps =
    agent.steps.length > 0 || agent.collapsedDelegations.length > 0;
  const [threadOpen, setThreadOpen] = useState(false);
  const running = agent.status === "running";
  const name = agent.name?.trim();
  const description = agent.description?.trim();
  const title = name || description || "Sub-agent";
  const showDescription = Boolean(description && description !== title);

  return (
    <div
      className="min-w-0 shrink-0 overflow-hidden rounded-lg border border-border bg-card shadow-none"
      data-event="subagent"
      data-call-id={agent.callId}
      data-status={agent.status}
    >
      <div className="border-l-2 border-l-[hsl(var(--current))] px-3 py-2.5">
        <div className="flex min-w-0 items-start gap-2">
          <div className="min-w-0 flex-1 space-y-1">
            <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[hsl(var(--current))]">
              Sub-agent
            </p>
            <div className="flex min-w-0 items-center gap-2">
              <h3 className="min-w-0 truncate font-mono text-xs font-medium text-foreground">
                {title}
              </h3>
              <Badge
                variant={toolStatusVariant(agent.status)}
                className={cn("shrink-0", running && "animate-pulse")}
              >
                {agent.status}
              </Badge>
            </div>
            {showDescription ? (
              <p className="break-words text-sm text-muted-foreground">
                {description}
              </p>
            ) : null}
          </div>
          {hasSteps ? (
            <button
              type="button"
              className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-md border border-border bg-[hsl(var(--panel-2))] px-3 py-2 font-mono text-[11px] text-muted-foreground transition-colors hover:border-[hsl(var(--rail-lit))] hover:text-foreground"
              aria-expanded={threadOpen}
              aria-controls={`subagent-thread-${agent.callId}`}
              onClick={() => setThreadOpen((open) => !open)}
            >
              <ChevronRight
                className={cn(
                  "h-3 w-3 shrink-0 transition-transform",
                  threadOpen && "rotate-90",
                )}
              />
              {threadOpen ? "Hide thread" : "Show thread"}
            </button>
          ) : null}
        </div>

        {agent.prompt ? (
          <div className="mt-2.5 rounded-md border border-border bg-[hsl(var(--panel-2))] px-2.5 py-2">
            <p className="mb-1 font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
              Prompt
            </p>
            <p className="whitespace-pre-wrap break-words text-sm text-foreground/90">
              {agent.prompt}
            </p>
          </div>
        ) : null}

        <CollapsiblePayload
          label="Result"
          value={agent.result}
          initiallyOpen={!running}
        />
      </div>

      {hasSteps && threadOpen ? (
        <div
          id={`subagent-thread-${agent.callId}`}
          className="border-t border-border bg-[hsl(var(--panel-2))]"
          data-slot="subagent-nested-thread"
        >
          <SubagentThread agent={agent} />
        </div>
      ) : null}
    </div>
  );
}
