import {
  useInfiniteQuery,
  useQuery,
  type UseInfiniteQueryResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { request } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import { PIPELINE_RUNS_LIMIT, type RecentRun } from "../run-list";
import type { RunSequence } from "../run-sequence";
import { pipelineKeys } from "./keys";

export type PipelineStepSource = {
  source: string;
  markdown: string;
};

export type PipelineRunsResponse = {
  runs: RecentRun[];
  nextCursor: string | null;
};

export function usePipelineRunsQuery(): UseInfiniteQueryResult<
  PipelineRunsResponse,
  Error
> {
  return useInfiniteQuery({
    queryKey: pipelineKeys.runs(),
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({
        limit: String(PIPELINE_RUNS_LIMIT),
      });
      if (pageParam != null) {
        params.set("cursor", pageParam);
      }
      return request<PipelineRunsResponse>(`/api/pipeline/runs?${params}`);
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });
}

export function usePipelineRunQuery(
  conversationId: string | undefined,
): UseQueryResult<RunSequence, Error> {
  return useQuery({
    queryKey: pipelineKeys.run(conversationId ?? ""),
    queryFn: () =>
      request<RunSequence>(
        `/api/pipeline/runs/${encodeURIComponent(conversationId!)}`,
      ),
    enabled: Boolean(conversationId),
    retry: (count, error) =>
      !(error instanceof ApiError && error.status === 404) && count < 2,
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
