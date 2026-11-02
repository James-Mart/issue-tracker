import type { NestedStep, TranscriptEvent } from "@server/schemas";
import { extractTaskHints } from "@server/services/task-hints";
import {
  findOpenThinkingIndex,
  isBlankThinkingText,
  isNestedThinkingInterrupt,
} from "./thinking-coalesce";

/** View-model for one delegated run: the tool call that spawned it plus its thread. */
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
  /**
   * Runs this one delegated, in first-frame order. Each `callId` is the
   * `tool_call` step in `steps` that spawned it, unless that step has not
   * arrived yet.
   */
  nestedRuns: SubAgent[];
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
 * streaming coalescing: consecutive text deltas concatenate; thinking looks
 * past invisible `liveness` via the shared coalesce helper; a finalize frame
 * that repeats the coalesced text is skipped; nested `tool_call` frames with
 * the same `callId` replace in place. Empty / whitespace-only thinking never
 * becomes a row.
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

  if (step.kind === "thinking") {
    if (isBlankThinkingText(step.text)) return steps;

    const idx = findOpenThinkingIndex(
      steps,
      (s) => s.kind === "thinking",
      isNestedThinkingInterrupt,
    );
    if (idx < 0) return [...steps, step];

    const last = steps[idx] as Extract<NestedStep, { kind: "thinking" }>;
    if (step.text === last.text) return steps;

    const next = steps.slice();
    next[idx] = { kind: "thinking", text: last.text + step.text };
    return next;
  }

  if (step.kind === "text") {
    const last = steps[steps.length - 1];
    if (last?.kind === "text") {
      if (step.text === last.text) return steps;
      const next = steps.slice();
      next[next.length - 1] = {
        kind: "text",
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
function parseSubAgentArgs(
  args: Record<string, unknown> | undefined,
): Pick<SubAgent, "name" | "description" | "prompt"> {
  if (!args) return {};
  const description = optionalString(args.description);
  const prompt = optionalString(args.prompt);

  let name = optionalString(args.name);
  const subagentType = args.subagentType;
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

/** `subagent_update` frames folded for one nested run. */
type RunFrames = {
  /** Tool call that spawned the run. */
  parentCallId: string;
  delegationId?: string;
  model?: string;
  elapsedMs?: number;
  steps: NestedStep[];
};

type RunIndex = {
  /** Every run, by {@link runKey}. */
  runs: Map<string, RunFrames>;
  /** Runs a nested run delegated, by that run's `delegationId`, in first-frame order. */
  childRuns: Map<string, RunFrames[]>;
};

/** Spawning call ids are only unique within the run that made the call. */
function runKey(parentDelegationId: string | undefined, parentCallId: string) {
  return `${parentDelegationId ?? ""}\n${parentCallId}`;
}

function indexRuns(events: TranscriptEvent[]): RunIndex {
  const runs = new Map<string, RunFrames>();
  const childRuns = new Map<string, RunFrames[]>();
  for (const event of events) {
    if (event.type !== "subagent_update") continue;
    const { parentCallId, parentDelegationId } = event;
    const key = runKey(parentDelegationId, parentCallId);
    let run = runs.get(key);
    if (!run) {
      run = { parentCallId, steps: [] };
      runs.set(key, run);
      if (parentDelegationId) {
        const siblings = childRuns.get(parentDelegationId);
        if (siblings) siblings.push(run);
        else childRuns.set(parentDelegationId, [run]);
      }
    }
    run.steps = applyNestedStep(run.steps, event.step);
    if (event.delegationId) run.delegationId = event.delegationId;
    if (event.model) run.model = normalizeModel(event.model);
    if (event.step.kind === "liveness") run.elapsedMs = event.step.elapsedMs;
  }
  return { runs, childRuns };
}

/** The tool call that spawned a run, at the top level or as a nested step. */
type RunSpawn = Pick<
  Extract<TranscriptEvent, { type: "tool_call" }>,
  "callId" | "status" | "args" | "result" | "resultAgentId"
>;

function toSubAgent(
  spawn: RunSpawn,
  run: RunFrames | undefined,
  index: RunIndex,
): SubAgent {
  const steps = run?.steps ?? [];
  const children = run?.delegationId
    ? (index.childRuns.get(run.delegationId) ?? [])
    : [];
  let nestedRuns: SubAgent[] = [];
  if (children.length > 0) {
    const spawnByCallId = new Map<
      string,
      Extract<NestedStep, { kind: "tool_call" }>
    >();
    for (const step of steps) {
      if (step.kind === "tool_call") spawnByCallId.set(step.callId, step);
    }
    nestedRuns = children.map((child) =>
      toSubAgent(
        runSpawnFromToolCall(
          child.parentCallId,
          spawnByCallId.get(child.parentCallId),
        ),
        child,
        index,
      ),
    );
  }
  const unwrapped = unwrapDelegateArgs(spawn.args);
  const fields = parseSubAgentArgs(unwrapped);
  const role = optionalString(unwrapped?.role) ?? fields.name;
  return {
    callId: spawn.callId,
    ...fields,
    ...(role ? { role } : {}),
    ...(run?.model ? { model: run.model } : {}),
    ...(run?.elapsedMs !== undefined ? { elapsedMs: run.elapsedMs } : {}),
    status: spawn.status,
    ...(spawn.result !== undefined ? { result: spawn.result } : {}),
    ...(spawn.resultAgentId ? { resumeAgentId: spawn.resultAgentId } : {}),
    steps,
    nestedRuns,
  };
}

/**
 * Spawn for a run from its `tool_call`, at the top level or as a nested step.
 * A deeper run's first frames can land before that step does; until then it
 * is still running. Resume hints are the event's `resultAgentId` when the
 * pipeline already lifted them, otherwise the same fields on `result`.
 */
function runSpawnFromToolCall(
  callId: string,
  tool:
    | {
        status: RunSpawn["status"];
        args?: unknown;
        result?: unknown;
        resultAgentId?: string;
      }
    | undefined,
): RunSpawn {
  if (!tool) return { callId, status: "running" };
  const hints = extractTaskHints(tool.result);
  return {
    callId,
    status: tool.status,
    ...(tool.args !== undefined ? { args: tool.args } : {}),
    ...(tool.result !== undefined ? { result: tool.result } : {}),
    ...hints,
    ...(tool.resultAgentId ? { resultAgentId: tool.resultAgentId } : {}),
  };
}

/**
 * Derive {@link SubAgent} view-models from a conversation transcript (replayed
 * finalized events and/or live incremental frames). Equivalent `steps` from
 * either source thanks to {@link applyNestedStep}. Every depth nests the runs
 * it delegated in {@link SubAgent.nestedRuns}.
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

  const index = indexRuns(events);
  return order.map((callId) =>
    toSubAgent(
      runSpawnFromToolCall(callId, latest.get(callId)),
      index.runs.get(runKey(undefined, callId)),
      index,
    ),
  );
}

/** Look up a single {@link SubAgent} by parent Task `callId`. */
export function deriveSubAgent(
  events: TranscriptEvent[],
  callId: string,
): SubAgent | undefined {
  return deriveSubAgents(events).find((a) => a.callId === callId);
}
