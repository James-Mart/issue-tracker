import type { NestedStep, TranscriptEvent } from "@server/schemas";

/** Collapsed summary for a nested run deeper than one level of nesting. */
export type CollapsedDelegation = {
  delegationId: string;
  /** Tool call that started this deeper run (matches a depth-1 `tool_call` step). */
  parentCallId: string;
  role?: string;
  model?: string;
  status: Extract<TranscriptEvent, { type: "tool_call" }>["status"];
  elapsedMs?: number;
};

/** View-model for one parent Task/Agent tool_call plus its nested thread. */
export type SubAgent = {
  callId: string;
  name?: string;
  description?: string;
  prompt?: string;
  /** Delegation role from tool args (`role` or subagent type name). */
  role?: string;
  model?: string;
  elapsedMs?: number;
  status: Extract<TranscriptEvent, { type: "tool_call" }>["status"];
  result?: unknown;
  resumeAgentId?: string;
  steps: NestedStep[];
  /** Depth-2+ runs, one row each, keyed by `delegationId`. */
  collapsedDelegations: CollapsedDelegation[];
};

const SUBAGENT_TOOL_NAMES = new Set(["agent", "task"]);

/** True when a tool_call `name` is the sub-agent spawn tool. */
export function isSubAgentToolName(
  name: string | undefined | null,
): boolean {
  return typeof name === "string" && SUBAGENT_TOOL_NAMES.has(name.toLowerCase());
}

function isMcpDelegateArgs(args: unknown): boolean {
  if (!args || typeof args !== "object") return false;
  const a = args as Record<string, unknown>;
  return (
    optionalString(a.providerIdentifier) === "custom-user-tools" &&
    optionalString(a.toolName) === "delegate" &&
    a.args !== undefined &&
    typeof a.args === "object"
  );
}

export function isSubAgentToolCall(
  event: TranscriptEvent,
): event is Extract<TranscriptEvent, { type: "tool_call" }> {
  return (
    event.type === "tool_call" &&
    (isSubAgentToolName(event.name) || isMcpDelegateArgs(event.args))
  );
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

/** Flat Task/Agent args, or nested `args` on an app-channel MCP delegate call. */
function unwrapDelegateArgs(args: unknown): Record<string, unknown> | undefined {
  if (!args || typeof args !== "object") return undefined;
  const a = args as Record<string, unknown>;
  if (isMcpDelegateArgs(args)) {
    return a.args as Record<string, unknown>;
  }
  return a;
}

function normalizeModel(model: string): string {
  if (model.startsWith("{")) {
    try {
      const parsed = JSON.parse(model) as { id?: string };
      if (typeof parsed.id === "string") return parsed.id;
    } catch {
      // Keep the raw string when JSON parsing fails.
    }
  }
  return model;
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
  const a = unwrapDelegateArgs(args);
  if (!a) return {};
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

/** Role label for a deeper run: `delegate` args.role, else Task/Agent name. */
function roleFromToolArgs(args: unknown): string | undefined {
  const a = unwrapDelegateArgs(args);
  if (!a) return undefined;
  return optionalString(a.role) ?? parseSubAgentArgs(args).name;
}

/** Latest model and elapsed time from depth-1 `subagent_update` frames. */
function deriveRootDelegationMeta(
  events: TranscriptEvent[],
  rootCallId: string,
): Pick<SubAgent, "model" | "elapsedMs"> {
  let model: string | undefined;
  let elapsedMs: number | undefined;
  for (const event of events) {
    if (event.type !== "subagent_update") continue;
    if (event.parentCallId !== rootCallId) continue;
    if (event.parentDelegationId) continue;
    if (event.model) model = normalizeModel(event.model);
    if (event.step.kind === "liveness") {
      elapsedMs = event.step.elapsedMs;
    }
  }
  return {
    ...(model ? { model } : {}),
    ...(elapsedMs !== undefined ? { elapsedMs } : {}),
  };
}

/**
 * Collapse depth-2+ `subagent_update` frames (those with `parentDelegationId`
 * equal to this card's root `delegationId`) into one summary row per run.
 */
function deriveCollapsedDelegations(
  events: TranscriptEvent[],
  rootCallId: string,
  steps: NestedStep[],
): CollapsedDelegation[] {
  let rootDelegationId: string | undefined;
  for (const event of events) {
    if (event.type !== "subagent_update") continue;
    if (event.parentCallId !== rootCallId) continue;
    if (event.parentDelegationId) continue;
    if (event.delegationId) {
      rootDelegationId = event.delegationId;
      break;
    }
  }
  if (!rootDelegationId) return [];

  const toolByCallId = new Map<
    string,
    Extract<NestedStep, { kind: "tool_call" }>
  >();
  for (const step of steps) {
    if (step.kind === "tool_call") toolByCallId.set(step.callId, step);
  }

  const order: string[] = [];
  const latest = new Map<
    string,
    {
      parentCallId: string;
      model?: string;
      elapsedMs?: number;
    }
  >();

  for (const event of events) {
    if (event.type !== "subagent_update") continue;
    if (event.parentDelegationId !== rootDelegationId) continue;
    if (!event.delegationId) continue;
    const { delegationId } = event;
    if (!latest.has(delegationId)) {
      order.push(delegationId);
      latest.set(delegationId, { parentCallId: event.parentCallId });
    }
    const row = latest.get(delegationId)!;
    row.parentCallId = event.parentCallId;
    if (event.model) row.model = event.model;
    if (event.step.kind === "liveness") {
      row.elapsedMs = event.step.elapsedMs;
    }
  }

  return order.map((delegationId) => {
    const row = latest.get(delegationId)!;
    const tool = toolByCallId.get(row.parentCallId);
    const role = roleFromToolArgs(tool?.args);
    return {
      delegationId,
      parentCallId: row.parentCallId,
      ...(role ? { role } : {}),
      ...(row.model ? { model: row.model } : {}),
      status: tool?.status ?? "running",
      ...(row.elapsedMs !== undefined ? { elapsedMs: row.elapsedMs } : {}),
    };
  });
}

/**
 * Derive {@link SubAgent} view-models from a conversation transcript (replayed
 * finalized events and/or live incremental frames). Equivalent `steps` from
 * either source thanks to {@link applyNestedStep}. Depth-1 steps stay expanded;
 * deeper runs collapse into {@link SubAgent.collapsedDelegations}.
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
        event.parentCallId === callId &&
        // Depth-1 only: deeper runs carry parentDelegationId and collapse.
        !event.parentDelegationId
      ) {
        steps = applyNestedStep(steps, event.step);
      }
    }
    const fields = parseSubAgentArgs(toolCall.args);
    const role = roleFromToolArgs(toolCall.args);
    return {
      callId,
      ...fields,
      ...(role ? { role } : {}),
      ...deriveRootDelegationMeta(events, callId),
      status: toolCall.status,
      ...(toolCall.result !== undefined ? { result: toolCall.result } : {}),
      ...(toolCall.resultAgentId
        ? { resumeAgentId: toolCall.resultAgentId }
        : {}),
      steps,
      collapsedDelegations: deriveCollapsedDelegations(events, callId, steps),
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
