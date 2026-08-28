import { pipelines, type Pipeline, type PipelineId } from "./shape";

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
