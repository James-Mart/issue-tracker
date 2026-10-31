import type { TranscriptEventInput } from "../schemas.js";

/**
 * Post-completion hints off a Task/Agent `tool_call.result`. The SDK's task
 * result wraps them in a `{ status, value }` envelope; the app-hosted
 * `delegate` bridge returns them flat. Read whichever shape arrived.
 */
export function extractTaskHints(
  result: unknown,
): Pick<
  Extract<TranscriptEventInput, { type: "tool_call" }>,
  "resultAgentId" | "transcriptPath"
> {
  const outer = asRecord(result);
  if (!outer) return {};
  const r = asRecord(outer.value) ?? outer;
  return {
    ...(typeof r.agentId === "string" && r.agentId.trim()
      ? { resultAgentId: r.agentId.trim() }
      : {}),
    ...(typeof r.transcriptPath === "string" && r.transcriptPath.trim()
      ? { transcriptPath: r.transcriptPath.trim() }
      : {}),
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}
