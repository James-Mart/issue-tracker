import { publishFrame } from "./conversation-stream.js";

export const PIPELINE_RUNS_TOPIC = "pipeline:runs";

/** Notify pipeline run list subscribers that a run's live marker changed. */
export function publishPipelineRunEvent(
  status: "started" | "finished",
  conversationId: string,
): void {
  publishFrame(PIPELINE_RUNS_TOPIC, {
    event: { type: "pipeline-run", status, conversationId },
    persist: false,
  });
}
