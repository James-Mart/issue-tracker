import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { request } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import { pipelineKeys } from "./keys";

export type PipelineStepSource = {
  source: string;
  markdown: string;
};

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
