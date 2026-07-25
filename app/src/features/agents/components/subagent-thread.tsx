import type { NestedStep } from "@server/schemas";
import type { SubAgent } from "../lib/subagent";
import {
  indexedStreamKey,
  toolCallRowKey,
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
}: {
  step: NestedStep;
  thinkingOpen?: boolean;
}) {
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
 * (text / thinking / tool_call / step). Same view-model for live stream and
 * history replay — do not nest a second level.
 */
export function SubagentThread({ agent }: { agent: SubAgent }) {
  if (agent.steps.length === 0) return null;

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
      <div
        className="space-y-2 border-l-2 border-l-[hsl(var(--current)/0.45)] pl-3"
        role="list"
        aria-label="Sub-agent thread"
      >
        {agent.steps.map((step, index) => (
          <div key={stepKey(step, index)} role="listitem">
            <NestedStepRow
              step={step}
              thinkingOpen={
                running &&
                step.kind === "thinking" &&
                isLiveNestedThinking(agent.steps, index)
              }
            />
          </div>
        ))}
      </div>
    </div>
  );
}
