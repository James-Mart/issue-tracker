import { pipelines, type Pipeline, type PipelineId } from "./shape";

export function isSelectableStepId(
  pipeline: Pipeline,
  stepId: string,
): boolean {
  const node = pipeline.nodes.find((candidate) => candidate.id === stepId);
  return node != null && node.kind !== "handoff";
}

/** Parse `step` query value; unknown, handoff, or absent → undefined. */
export function parseStepId(
  value: string | null,
  pipeline: Pipeline,
): string | undefined {
  if (value != null && isSelectableStepId(pipeline, value)) return value;
  return undefined;
}

/** Write the selected step into search params. Absent selection omits it. */
export function writeStepParam(
  params: URLSearchParams,
  stepId: string | undefined,
): URLSearchParams {
  const next = new URLSearchParams(params);
  if (stepId) next.set("step", stepId);
  else next.delete("step");
  return next;
}

/** Design view starts on planning; the URL omits the param when that is selected. */
export const DEFAULT_PIPELINE_ID: PipelineId = "planning";

export function isPipelineId(value: string): value is PipelineId {
  return pipelines.some((pipeline) => pipeline.id === value);
}

/** Parse `pipeline` query value; unknown or absent → planning. */
export function parsePipelineId(value: string | null): PipelineId {
  if (value != null && isPipelineId(value)) return value;
  return DEFAULT_PIPELINE_ID;
}

/**
 * Write the selected pipeline into search params. Default (`planning`) omits
 * the param so the URL stays clean when absent means planning.
 */
export function writePipelineParam(
  params: URLSearchParams,
  id: PipelineId,
): URLSearchParams {
  const next = new URLSearchParams(params);
  if (id === DEFAULT_PIPELINE_ID) {
    next.delete("pipeline");
  } else {
    next.set("pipeline", id);
  }
  return next;
}

export function pipelineById(id: PipelineId): Pipeline {
  const pipeline = pipelines.find((candidate) => candidate.id === id);
  if (!pipeline) throw new Error(`Unknown pipeline: ${id}`);
  return pipeline;
}
