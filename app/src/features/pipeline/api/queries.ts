import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { request } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import { PIPELINE_RUNS_LIMIT, type RecentRun } from "../run-list";
import { pipelineKeys } from "./keys";

export type PipelineStepSource = {
  source: string;
  markdown: string;
};

export type PipelineRunsResponse = {
  runs: RecentRun[];
};

export function usePipelineRunsQuery(): UseQueryResult<
  PipelineRunsResponse,
  Error
> {
  return useQuery({
    queryKey: pipelineKeys.runs(),
    queryFn: () =>
      request<PipelineRunsResponse>(
        `/api/pipeline/runs?limit=${PIPELINE_RUNS_LIMIT}`,
      ),
  });
}

export function usePipelineStepSourceQuery(
  stepId: string | undefined,
): UseQueryResult<PipelineStepSource, Error> {
  return useQuery({
    queryKey: pipelineKeys.stepSource(stepId ?? ""),
    queryFn: () =>
      request<PipelineStepSource>(
        `/api/pipeline/steps/${encodeURIComponent(stepId!)}/source`,
      ),
    enabled: Boolean(stepId),
    retry: (count, error) =>
      !(error instanceof ApiError && error.status === 404) && count < 2,
  });
}
