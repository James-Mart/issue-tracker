import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils/cn";
import type { SubAgent } from "../lib/subagent";
import { SubagentThread } from "./subagent-thread";
import {
  CollapsibleDetails,
  CollapsiblePayload,
  toolStatusVariant,
} from "./transcript-ui";

function formatElapsed(ms: number): string {
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  return rem > 0 ? `${min}m ${rem}s` : `${min}m`;
}

/** At-rest sub-agent card; falls back to a standalone card when `steps` is empty. */
export function SubagentCard({ agent }: { agent: SubAgent }) {
  const hasSteps =
    agent.steps.length > 0 || agent.collapsedDelegations.length > 0;
  const [threadOpen, setThreadOpen] = useState(false);
  const running = agent.status === "running";
  const role =
    agent.role?.trim() ||
    agent.name?.trim() ||
    agent.description?.trim() ||
    "delegation";

  return (
    <CollapsibleDetails
      className="min-w-0 shrink-0 overflow-hidden rounded-lg border border-border bg-card shadow-none"
      summaryClassName="min-h-0 gap-2 border-l-2 border-l-[hsl(var(--current))] px-3 py-2.5"
      bodyClassName="border-t border-border px-3 py-2.5"
      initiallyOpen={agent.status === "error"}
      label={
        <>
          <Badge
            variant={toolStatusVariant(agent.status)}
            className={cn("shrink-0 text-[10px]", running && "animate-pulse")}
          >
            {agent.status}
          </Badge>
          <span className="shrink-0 font-mono text-xs font-medium text-foreground">
            {role}
          </span>
          {agent.model ? (
            <span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground">
              {agent.model}
            </span>
          ) : null}
          {agent.elapsedMs !== undefined ? (
            <span
              className="shrink-0 font-mono text-[11px] tabular-nums text-[hsl(var(--mut))]"
              data-elapsed-ms={agent.elapsedMs}
            >
              {formatElapsed(agent.elapsedMs)}
            </span>
          ) : null}
        </>
      }
      data-event="subagent"
      data-call-id={agent.callId}
      data-status={agent.status}
    >
      {agent.prompt ? (
        <div className="rounded-md border border-border bg-[hsl(var(--panel-2))] px-2.5 py-2">
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
        initiallyOpen={agent.status === "error"}
      />

      {hasSteps ? (
        <>
          <button
            type="button"
            className="mt-2 inline-flex min-h-11 items-center gap-1 rounded-md border border-border bg-[hsl(var(--panel-2))] px-3 py-2 font-mono text-[11px] text-muted-foreground transition-colors hover:border-[hsl(var(--rail-lit))] hover:text-foreground"
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
          {threadOpen ? (
            <div
              id={`subagent-thread-${agent.callId}`}
              className="-mx-3 -mb-2.5 mt-2 border-t border-border bg-[hsl(var(--panel-2))]"
              data-slot="subagent-nested-thread"
            >
              <SubagentThread agent={agent} />
            </div>
          ) : null}
        </>
      ) : null}
    </CollapsibleDetails>
  );
}
