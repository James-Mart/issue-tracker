import { useState } from "react";
import { ChevronRight } from "lucide-react";
import type { NestedStep } from "@server/schemas";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils/cn";
import type { SubAgent } from "../lib/subagent";
import { groupOrdinaryNestedToolCalls } from "../lib/transcript-rows";
import {
  CollapsibleDetails,
  CollapsiblePayload,
  indexedStreamKey,
  toolCallRowKey,
  toolStatusVariant,
  ToolUseGroup,
  TranscriptMarkdownText,
  TranscriptThinking,
  TranscriptToolCall,
} from "./transcript-ui";

function formatElapsed(ms: number): string {
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  return rem > 0 ? `${min}m ${rem}s` : `${min}m`;
}

function stepKey(step: NestedStep, index: number): string {
  if (step.kind === "tool_call") return toolCallRowKey(step.callId);
  if (step.kind === "step") {
    return indexedStreamKey(index, `step-${step.stepId}-${step.status}`);
  }
  return indexedStreamKey(index, step.kind);
}

/**
 * True when no later nested step has superseded this thinking block — mirrors
 * top-level `isLiveThinking` (text stands in for assistant).
 */
function isLiveNestedThinking(steps: NestedStep[], index: number): boolean {
  for (let i = index + 1; i < steps.length; i++) {
    const kind = steps[i]?.kind;
    if (kind === "thinking" || kind === "text" || kind === "tool_call") {
      return false;
    }
  }
  return true;
}

function NestedStepMarker({
  step,
}: {
  step: Extract<NestedStep, { kind: "step" }>;
}) {
  return (
    <div
      className="flex flex-wrap items-baseline gap-x-2 px-1 py-0.5 font-mono text-[11px] text-muted-foreground"
      data-nested="step"
      data-step-id={step.stepId}
      data-status={step.status}
    >
      <span className="uppercase tracking-[0.08em] text-[hsl(var(--mut))]">
        Step {step.stepId}
      </span>
      <span className="text-foreground/80">{step.status}</span>
    </div>
  );
}

function NestedStepRow({
  step,
  thinkingOpen,
  mermaidStreaming,
}: {
  step: NestedStep;
  thinkingOpen?: boolean;
  mermaidStreaming?: boolean;
}) {
  switch (step.kind) {
    case "text":
      return (
        <TranscriptMarkdownText
          text={step.text}
          renderMermaid
          {...(mermaidStreaming ? { mermaidStreaming: true } : {})}
          data-nested="text"
        />
      );
    case "thinking":
      return (
        <TranscriptThinking
          text={step.text}
          open={thinkingOpen}
          density="compact"
          data-nested="thinking"
        />
      );
    case "tool_call":
      return (
        <TranscriptToolCall
          callId={step.callId}
          name={step.name}
          status={step.status}
          args={step.args}
          result={step.result}
          density="compact"
          data-nested="tool_call"
        />
      );
    case "step":
      return <NestedStepMarker step={step} />;
    default:
      return null;
  }
}

/** Visual-only resume hint — v1 does not wire Agent.resume. */
function ResumeAffordance({ agentId }: { agentId: string }) {
  return (
    <div
      className="flex flex-wrap items-center gap-2 rounded-md border border-dashed border-[hsl(var(--rail-lit))] bg-card/60 px-2.5 py-1.5"
      data-slot="subagent-resume"
      title="Resume is visual only in v1"
    >
      <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-[hsl(var(--current))]">
        Resume
      </span>
      <span className="font-mono text-[11px] text-muted-foreground">
        {agentId}
      </span>
      <span className="font-mono text-[10px] text-[hsl(var(--mut))]">
        visual only
      </span>
    </div>
  );
}

/**
 * Nested thread for a sub-agent card: ordered `SubAgent.steps` (text /
 * thinking / tool_call / step). Each run it delegated renders as a
 * {@link SubagentCard} at its spawning tool call, or after the steps while
 * that call has not arrived.
 */
function SubagentThread({ agent }: { agent: SubAgent }) {
  const nestedRunsByCallId = new Map(
    agent.nestedRuns.map((run) => [run.callId, run]),
  );
  const placedCallIds = new Set(
    agent.steps.flatMap((step) =>
      step.kind === "tool_call" ? [step.callId] : [],
    ),
  );
  const unplacedRuns = agent.nestedRuns.filter(
    (run) => !placedCallIds.has(run.callId),
  );
  const hasBody =
    agent.steps.length > 0 ||
    unplacedRuns.length > 0 ||
    Boolean(agent.resumeAgentId);

  if (!hasBody) return null;

  const running = agent.status === "running";
  const segments = groupOrdinaryNestedToolCalls(
    agent.steps,
    nestedRunsByCallId,
  );

  return (
    <div
      className="space-y-2.5 px-3 py-3"
      data-slot="subagent-thread"
      data-call-id={agent.callId}
    >
      {agent.resumeAgentId ? (
        <ResumeAffordance agentId={agent.resumeAgentId} />
      ) : null}
      {segments.length > 0 || unplacedRuns.length > 0 ? (
        <div
          className="space-y-2 border-l-2 border-l-[hsl(var(--current)/0.45)] pl-3"
          role="list"
          aria-label="Sub-agent thread"
        >
          {segments.map((segment) => {
            if (segment.kind === "tool_use_group") {
              return (
                <div
                  key={`tool_use_group-${segment.steps[0]!.callId}`}
                  role="listitem"
                >
                  <ToolUseGroup
                    tools={segment.steps}
                    density="compact"
                    data-nested="tool_use_group"
                  />
                </div>
              );
            }
            const { step, index } = segment;
            const nestedRun =
              step.kind === "tool_call"
                ? nestedRunsByCallId.get(step.callId)
                : undefined;
            return (
              <div key={stepKey(step, index)} role="listitem">
                {nestedRun ? (
                  <SubagentCard agent={nestedRun} />
                ) : (
                  <NestedStepRow
                    step={step}
                    thinkingOpen={
                      running &&
                      step.kind === "thinking" &&
                      isLiveNestedThinking(agent.steps, index)
                    }
                    mermaidStreaming={
                      running &&
                      step.kind === "text" &&
                      isLiveNestedThinking(agent.steps, index)
                    }
                  />
                )}
              </div>
            );
          })}
          {unplacedRuns.map((run) => (
            <div key={toolCallRowKey(run.callId)} role="listitem">
              <SubagentCard agent={run} />
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** At-rest sub-agent card; falls back to a standalone card when `steps` is empty. */
export function SubagentCard({ agent }: { agent: SubAgent }) {
  const hasSteps = agent.steps.length > 0 || agent.nestedRuns.length > 0;
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
