import type { AgentRun } from "@server/schemas";
import type { RunSequence } from "./run-sequence";

export const AT = "2026-08-28T12:00:00.000Z";
export const AT_NESTED = "2026-08-28T12:00:12.000Z";

/** An in-flight run whose only beat is the coordinator's open implementor spawn. */
export function inFlightSequence(): RunSequence {
  return {
    condition: "in-flight",
    lifelines: [
      { id: "coordinator", label: "implementing", kind: "coordinator" },
      { id: "implementor", label: "implementor", kind: "role" },
    ],
    sections: [],
    beats: [
      {
        from: "coordinator",
        to: "implementor",
        label: "spawn implementor",
        startedAt: AT,
        kind: "spawn",
        parentCallId: "call-impl",
      },
    ],
  };
}

/** A nested validator delegation that a live frame appends to `inFlightSequence`. */
export function sampleRun(): AgentRun {
  return {
    delegationId: "del-qa",
    agentId: "agent-qa",
    role: "validator",
    model: "composer-2.5",
    issueId: "run-live-updates",
    parentCallId: "call-qa",
    conversationId: "conv-live",
    startedAt: AT_NESTED,
    status: "running",
    isResume: false,
  };
}
