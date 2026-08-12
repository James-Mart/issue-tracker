import type { NestedStep, TranscriptEvent } from "@server/schemas";
import { isSubAgentToolCall, type CollapsedDelegation } from "./subagent";

/** Info-line payload when an event renders as a labeled row in the thread body. */
export type TranscriptInfoLine = {
  label: string;
  text: string;
};

export type OrdinaryToolCallEvent = Extract<
  TranscriptEvent,
  { type: "tool_call" }
>;

export type TranscriptRenderSegment =
  | { kind: "row"; event: TranscriptEvent }
  | { kind: "tool_use_group"; events: OrdinaryToolCallEvent[] };

export type OrdinaryNestedToolCall = Extract<NestedStep, { kind: "tool_call" }>;

export type NestedTranscriptRenderSegment =
  | { kind: "row"; step: NestedStep }
  | { kind: "tool_use_group"; steps: OrdinaryNestedToolCall[] };

export type ToolUseGroupStatus = OrdinaryToolCallEvent["status"];

/** True when a tool_call row renders as TranscriptToolCall, not SubagentCard. */
export function isOrdinaryToolCall(
  event: TranscriptEvent,
): event is OrdinaryToolCallEvent {
  return event.type === "tool_call" && !isSubAgentToolCall(event);
}

/**
 * Events omitted from the thread body (same set TranscriptEventRow returns
 * null for). They must not split a Tool use group.
 */
function isOmittedTranscriptRow(event: TranscriptEvent): boolean {
  switch (event.type) {
    case "usage":
    case "subagent_update":
      return true;
    case "status":
      return !event.message;
    default:
      return false;
  }
}

/** Aggregate header status for a Tool use group (never empty). */
export function toolUseGroupStatus(
  events: readonly { status: ToolUseGroupStatus }[],
): ToolUseGroupStatus {
  if (events.some((event) => event.status === "error")) return "error";
  if (events.some((event) => event.status === "running")) return "running";
  return "completed";
}

/**
 * Tool whose name / one-line summary appears in the collapsed group header.
 * Latest running child in transcript order while any run; otherwise the last child.
 */
export function toolUseGroupHintEvent<T extends { status: ToolUseGroupStatus }>(
  events: readonly T[],
): T | undefined {
  if (events.length === 0) return undefined;
  let latestRunning: T | undefined;
  for (const event of events) {
    if (event.status === "running") {
      latestRunning = event;
    }
  }
  return latestRunning ?? events[events.length - 1];
}

/**
 * Fold consecutive ordinary tool_call events into Tool use groups. Thinking,
 * assistant text, SubagentCard, and any other visible non-ordinary-tool row
 * break a group. A lone ordinary tool still becomes a one-item group.
 */
export function groupOrdinaryToolCalls(
  events: readonly TranscriptEvent[],
): TranscriptRenderSegment[] {
  const segments: TranscriptRenderSegment[] = [];
  let group: OrdinaryToolCallEvent[] = [];

  const flushGroup = () => {
    if (group.length === 0) return;
    segments.push({ kind: "tool_use_group", events: group });
    group = [];
  };

  for (const event of events) {
    if (isOrdinaryToolCall(event)) {
      group.push(event);
      continue;
    }
    if (isOmittedTranscriptRow(event)) continue;
    flushGroup();
    segments.push({ kind: "row", event });
  }
  flushGroup();
  return segments;
}

/** True when a nested tool_call row renders as TranscriptToolCall, not CollapsedDelegationRow. */
function isOrdinaryNestedToolCall(
  step: NestedStep,
  collapsedByCallId: ReadonlyMap<string, CollapsedDelegation>,
): step is OrdinaryNestedToolCall {
  return step.kind === "tool_call" && !collapsedByCallId.has(step.callId);
}

/**
 * Fold consecutive ordinary nested tool_call steps into Tool use groups.
 * Thinking, text, step markers, CollapsedDelegationRow, and any other visible
 * non-ordinary-tool step break a group. Liveness is omitted without splitting.
 * A lone ordinary nested tool still becomes a one-item group.
 */
export function groupOrdinaryNestedToolCalls(
  steps: readonly NestedStep[],
  collapsedByCallId: ReadonlyMap<string, CollapsedDelegation>,
): NestedTranscriptRenderSegment[] {
  const segments: NestedTranscriptRenderSegment[] = [];
  let group: OrdinaryNestedToolCall[] = [];

  const flushGroup = () => {
    if (group.length === 0) return;
    segments.push({ kind: "tool_use_group", steps: group });
    group = [];
  };

  for (const step of steps) {
    if (isOrdinaryNestedToolCall(step, collapsedByCallId)) {
      group.push(step);
      continue;
    }
    if (step.kind === "liveness") continue;
    flushGroup();
    segments.push({ kind: "row", step });
  }
  flushGroup();
  return segments;
}

/** Map bookkeeping events to labeled thread rows; null means omit from the body. */
export function transcriptInfoLine(
  event: TranscriptEvent,
): TranscriptInfoLine | null {
  switch (event.type) {
    case "usage":
      return null;
    case "status":
      if (!event.message) return null;
      return { label: "Status", text: event.message };
    case "task": {
      const parts = [event.status, event.text].filter(Boolean);
      return {
        label: "Task",
        text: parts.length > 0 ? parts.join(" · ") : "update",
      };
    }
    case "request":
      return { label: "Request", text: event.requestId };
    case "delegation_recovery":
      return { label: "Recovery", text: event.message };
    default:
      return null;
  }
}
