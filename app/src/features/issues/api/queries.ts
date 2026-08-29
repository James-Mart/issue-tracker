import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { request } from "@/lib/api/client";
import type {
  ChannelSessionListItem,
  CommentsResponse,
  ConversationChannel,
  IssueChange,
  IssueDetail,
  IssuesResponse,
} from "@server/schemas";
import type { PlanningWorkRoot } from "@server/services/planning-work-root";
import type { Attachment } from "@server/services/attachments";
import type { ProjectPrsResponse } from "@server/services/delivery";
import { ApiError } from "@/lib/api/errors";
import { attachmentsApiPath } from "../lib/attachments";
import { fetchIssueAgentRunEvents, fetchIssueAgentRuns } from "./agent-runs";
import { listChannelSessions } from "./channel-sessions";
import { healthKeys, issuesKeys } from "./keys";

export interface HealthResponse {
  bootId: string;
  startedAt: string;
  restartSupported: boolean;
}

export function useHealthQuery(): UseQueryResult<HealthResponse, Error> {
  return useQuery({
    queryKey: healthKeys.current(),
    queryFn: () => request<HealthResponse>("/api/health"),
  });
}

export function useIssuesQuery(): UseQueryResult<IssuesResponse, Error> {
  return useQuery({
    queryKey: issuesKeys.list(),
    queryFn: () => request<IssuesResponse>("/api/issues"),
  });
}

export function useIssueDetailQuery(
  id: string,
): UseQueryResult<IssueDetail, Error> {
  return useQuery({
    queryKey: issuesKeys.detail(id),
    queryFn: () => request<IssueDetail>(`/api/issues/${id}`),
    enabled: Boolean(id),
    retry: (count, error) =>
      !(error instanceof ApiError && error.status === 404) && count < 2,
  });
}

export function useCommentsQuery(id: string): UseQueryResult<CommentsResponse, Error> {
  return useQuery({
    queryKey: issuesKeys.comments(id),
    queryFn: () => request<CommentsResponse>(`/api/issues/${id}/comments`),
    enabled: Boolean(id),
    retry: (count, error) =>
      !(error instanceof ApiError && error.status === 404) && count < 2,
  });
}

export function useIssueAgentRunsQuery(
  issueId: string,
): UseQueryResult<Awaited<ReturnType<typeof fetchIssueAgentRuns>>, Error> {
  return useQuery({
    queryKey: issuesKeys.agentRuns(issueId),
    queryFn: () => fetchIssueAgentRuns(issueId),
    enabled: Boolean(issueId),
    retry: (count, error) =>
      !(error instanceof ApiError && error.status === 404) && count < 2,
  });
}

export function useIssueAgentRunEventsQuery(
  issueId: string,
  delegationId: string,
  expanded: boolean,
): UseQueryResult<Awaited<ReturnType<typeof fetchIssueAgentRunEvents>>, Error> {
  return useQuery({
    queryKey: issuesKeys.agentRunEvents(issueId, delegationId),
    queryFn: () => fetchIssueAgentRunEvents(issueId, delegationId),
    enabled: Boolean(issueId) && Boolean(delegationId) && expanded,
    retry: (count, error) =>
      !(error instanceof ApiError && error.status === 404) && count < 2,
  });
}

export function useAttachmentsQuery(
  id: string,
): UseQueryResult<Attachment[], Error> {
  return useQuery({
    queryKey: issuesKeys.attachments(id),
    queryFn: () => request<Attachment[]>(attachmentsApiPath(id)),
    enabled: Boolean(id),
    retry: (count, error) =>
      !(error instanceof ApiError && error.status === 404) && count < 2,
  });
}

/** Poll so closed-tab runs clear without an open SSE subscription. */
const CHANNEL_SESSIONS_REFETCH_INTERVAL_MS = 15_000;

export function usePlanningWorkRootQuery(
  ideaId: string | undefined,
): UseQueryResult<{ workRoot: PlanningWorkRoot | null }, Error> {
  return useQuery({
    queryKey: issuesKeys.planningWorkRoot(ideaId ?? ""),
    queryFn: () =>
      request<{ workRoot: PlanningWorkRoot | null }>(
        `/api/issues/${ideaId}/planning-work-root`,
      ),
    enabled: Boolean(ideaId),
  });
}

export function useChannelSessionsQuery(
  issueId: string,
  channel: ConversationChannel,
): UseQueryResult<ChannelSessionListItem[], Error> {
  return useQuery({
    queryKey: issuesKeys.channelSessions(issueId, channel),
    queryFn: () => listChannelSessions(issueId, channel),
    enabled: Boolean(issueId) && Boolean(channel),
    refetchOnWindowFocus: true,
    refetchInterval: CHANNEL_SESSIONS_REFETCH_INTERVAL_MS,
  });
}

/** Live PR facts for a Project — mount + explicit invalidation only. */
export function useProjectPullRequestsQuery(
  projectId: string,
): UseQueryResult<ProjectPrsResponse, Error> {
  return useQuery({
    queryKey: issuesKeys.projectPullRequests(projectId),
    queryFn: () =>
      request<ProjectPrsResponse>(`/api/projects/${projectId}/prs`),
    enabled: Boolean(projectId),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}

export function useIssueChangeQuery(
  issueId: string,
): UseQueryResult<IssueChange, Error> {
  return useQuery({
    queryKey: issuesKeys.change(issueId),
    queryFn: () => request<IssueChange>(`/api/issues/${issueId}/change`),
    enabled: Boolean(issueId),
    retry: (count, error) =>
      !(error instanceof ApiError && error.status >= 400 && error.status < 500) &&
      count < 2,
  });
}
