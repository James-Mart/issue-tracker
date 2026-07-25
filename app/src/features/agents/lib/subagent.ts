import type { NestedStep, TranscriptEvent } from "@server/schemas";

/** View-model for one parent Task/Agent tool_call plus its nested thread. */
export type SubAgent = {
  callId: string;
  name?: string;
  description?: string;
  prompt?: string;
  status: Extract<TranscriptEvent, { type: "tool_call" }>["status"];
  result?: unknown;
  resumeAgentId?: string;
  steps: NestedStep[];
};

const SUBAGENT_TOOL_NAMES = new Set(["Agent", "Task"]);

/** True when a tool_call `name` is the sub-agent spawn tool. */
export function isSubAgentToolName(
  name: string | undefined | null,
): boolean {
  return typeof name === "string" && SUBAGENT_TOOL_NAMES.has(name);
}

export function isSubAgentToolCall(
  event: TranscriptEvent,
): event is Extract<TranscriptEvent, { type: "tool_call" }> {
  return event.type === "tool_call" && isSubAgentToolName(event.name);
}

/**
 * Fold one nested step into an ordered timeline, mirroring top-level
 * streaming coalescing: consecutive text/thinking deltas concatenate and a
 * finalize frame that repeats the coalesced text is skipped; nested
 * `tool_call` frames with the same `callId` replace in place.
 */
export function applyNestedStep(
  steps: NestedStep[],
  step: NestedStep,
): NestedStep[] {
  if (step.kind === "tool_call") {
    const idx = steps.findIndex(
      (s) => s.kind === "tool_call" && s.callId === step.callId,
    );
    if (idx >= 0) {
      const next = steps.slice();
      next[idx] = step;
      return next;
    }
    return [...steps, step];
  }

  if (step.kind === "text" || step.kind === "thinking") {
    const last = steps[steps.length - 1];
    if (last?.kind === step.kind) {
      if (step.text === last.text) return steps;
      const next = steps.slice();
      next[next.length - 1] = {
        kind: step.kind,
        text: last.text + step.text,
      };
      return next;
    }
  }

  return [...steps, step];
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

/**
 * Defensively lift optional card fields from unstable tool_call `args`.
 * Only string scalars (and `subagentType.name` / `subagentType.kind`) are
 * accepted; anything else is ignored.
 */
function parseSubAgentArgs(args: unknown): Pick<
  SubAgent,
  "name" | "description" | "prompt"
> {
  if (!args || typeof args !== "object") return {};
  const a = args as Record<string, unknown>;
  const description = optionalString(a.description);
  const prompt = optionalString(a.prompt);

  let name = optionalString(a.name);
  const subagentType = a.subagentType;
  if (subagentType && typeof subagentType === "object") {
    const st = subagentType as Record<string, unknown>;
    name = optionalString(st.name) ?? optionalString(st.kind) ?? name;
  }

  return {
    ...(name ? { name } : {}),
    ...(description ? { description } : {}),
    ...(prompt ? { prompt } : {}),
  };
}

/**
 * Derive {@link SubAgent} view-models from a conversation transcript (replayed
 * finalized events and/or live incremental frames). Equivalent `steps` from
 * either source thanks to {@link applyNestedStep}.
 */
export function deriveSubAgents(events: TranscriptEvent[]): SubAgent[] {
  const latest = new Map<
    string,
    Extract<TranscriptEvent, { type: "tool_call" }>
  >();
  const order: string[] = [];

  for (const event of events) {
    if (!isSubAgentToolCall(event)) continue;
    if (!latest.has(event.callId)) order.push(event.callId);
    latest.set(event.callId, event);
  }

  return order.map((callId) => {
    const toolCall = latest.get(callId)!;
    let steps: NestedStep[] = [];
    for (const event of events) {
      if (
        event.type === "subagent_update" &&
        event.parentCallId === callId
      ) {
        steps = applyNestedStep(steps, event.step);
      }
    }
    const fields = parseSubAgentArgs(toolCall.args);
    return {
      callId,
      ...fields,
      status: toolCall.status,
      ...(toolCall.result !== undefined ? { result: toolCall.result } : {}),
      ...(toolCall.resultAgentId
        ? { resumeAgentId: toolCall.resultAgentId }
        : {}),
      steps,
    };
  });
}

/** Look up a single {@link SubAgent} by parent Task `callId`. */
export function deriveSubAgent(
  events: TranscriptEvent[],
  callId: string,
): SubAgent | undefined {
  return deriveSubAgents(events).find((a) => a.callId === callId);
}
