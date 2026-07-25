import type { NestedStep } from "@server/schemas";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils/cn";
import type { CollapsedDelegation, SubAgent } from "../lib/subagent";
import {
  indexedStreamKey,
  toolCallRowKey,
  toolStatusVariant,
  TranscriptMarkdownText,
  TranscriptThinking,
  TranscriptToolCall,
} from "./transcript-ui";

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

function formatElapsed(ms: number): string {
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  return rem > 0 ? `${min}m ${rem}s` : `${min}m`;
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

/** One-line supervision summary for a depth-2+ nested run. */
function CollapsedDelegationRow({ row }: { row: CollapsedDelegation }) {
  const running = row.status === "running";
  return (
    <div
      className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-border bg-card/60 px-2.5 py-1.5"
      data-nested="collapsed-delegation"
      data-delegation-id={row.delegationId}
      data-status={row.status}
    >
      <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-[hsl(var(--current))]">
        Nested
      </span>
      <span className="min-w-0 truncate font-mono text-xs font-medium text-foreground">
        {row.role ?? "delegation"}
      </span>
      {row.model ? (
        <span className="min-w-0 break-all font-mono text-[10px] text-muted-foreground">
          {row.model}
        </span>
      ) : null}
      <Badge
        variant={toolStatusVariant(row.status)}
        className={cn("shrink-0", running && "animate-pulse")}
      >
        {row.status}
      </Badge>
      {row.elapsedMs !== undefined ? (
        <span
          className="font-mono text-[11px] tabular-nums text-[hsl(var(--mut))]"
          data-elapsed-ms={row.elapsedMs}
        >
          {formatElapsed(row.elapsedMs)}
        </span>
      ) : null}
    </div>
  );
}

function NestedStepRow({
  step,
  thinkingOpen,
  collapsed,
}: {
  step: NestedStep;
  thinkingOpen?: boolean;
  collapsed?: CollapsedDelegation;
}) {
  if (step.kind === "tool_call" && collapsed) {
    return <CollapsedDelegationRow row={collapsed} />;
  }
  switch (step.kind) {
    case "text":
      return <TranscriptMarkdownText text={step.text} data-nested="text" />;
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
 * One-level nested thread for a sub-agent card: ordered `SubAgent.steps`
 * (text / thinking / tool_call / step). Deeper runs render as collapsed
 * summary rows via `collapsedDelegations` — not a second expanded level.
 */
export function SubagentThread({ agent }: { agent: SubAgent }) {
  const collapsedByCallId = new Map(
    agent.collapsedDelegations.map((row) => [row.parentCallId, row]),
  );
  const orphanCollapsed = agent.collapsedDelegations.filter(
    (row) =>
      !agent.steps.some(
        (step) => step.kind === "tool_call" && step.callId === row.parentCallId,
      ),
  );
  const hasBody =
    agent.steps.length > 0 ||
    orphanCollapsed.length > 0 ||
    Boolean(agent.resumeAgentId);

  if (!hasBody) return null;

  const running = agent.status === "running";

  return (
    <div
      className="space-y-2.5 px-3 py-3"
      data-slot="subagent-thread"
      data-call-id={agent.callId}
    >
      {agent.resumeAgentId ? (
        <ResumeAffordance agentId={agent.resumeAgentId} />
      ) : null}
      {agent.steps.length > 0 || orphanCollapsed.length > 0 ? (
        <div
          className="space-y-2 border-l-2 border-l-[hsl(var(--current)/0.45)] pl-3"
          role="list"
          aria-label="Sub-agent thread"
        >
          {agent.steps.map((step, index) => {
            const collapsed =
              step.kind === "tool_call"
                ? collapsedByCallId.get(step.callId)
                : undefined;
            return (
              <div key={stepKey(step, index)} role="listitem">
                <NestedStepRow
                  step={step}
                  collapsed={collapsed}
                  thinkingOpen={
                    running &&
                    step.kind === "thinking" &&
                    isLiveNestedThinking(agent.steps, index)
                  }
                />
              </div>
            );
          })}
          {orphanCollapsed.map((row) => (
            <div key={row.delegationId} role="listitem">
              <CollapsedDelegationRow row={row} />
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
