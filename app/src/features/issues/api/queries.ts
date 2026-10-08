import { useEffect, useMemo } from "react";
import {
  useQueries,
  useQuery,
  type UseQueryResult,
} from "@tanstack/react-query";
import { request, requestText } from "@/lib/api/client";
import type {
  ChannelSessionListItem,
  CommentsResponse,
  ConversationChannel,
  IssueChange,
  IssueDetail,
  IssuesResponse,
  ProjectWorktreesResponse,
} from "@server/schemas";
import type { PlanningWorkRoot } from "@server/services/planning-work-root";
import type { Attachment } from "@server/services/attachments";
import type { ProjectPrsResponse } from "@server/services/delivery";
import { ApiError } from "@/lib/api/errors";
import { attachmentsApiPath } from "../lib/attachments";
import { storedClientIds, withOutboxComments } from "../lib/comment-outbox";
import {
  groupCommentThreads,
  type CommentThreadsResult,
} from "../lib/comment-threads";
import {
  useCommentOutboxStore,
  useIssueCommentOutbox,
} from "../store/use-comment-outbox-store";
import { fetchIssueAgentRunEvents, fetchIssueAgentRuns } from "./agent-runs";
import { listChannelSessions } from "./channel-sessions";
import { healthKeys, issuesKeys, type ArchivedListParam } from "./keys";

export {
  selectAnchoredThreads,
  type CommentThread,
} from "../lib/comment-threads";

export interface HealthResponse {
  bootId: string;
  startedAt: string;
  restartSupported: boolean;
  guest: boolean;
}

export function useHealthQuery(): UseQueryResult<HealthResponse, Error> {
  return useQuery({
    queryKey: healthKeys.current(),
    queryFn: () => request<HealthResponse>("/api/health"),
  });
}

type ReuseMountedReadOptions = {
  refetchOnMount?: boolean | "always";
};

/**
 * A later subscriber reuses a read that is already in flight or cached.
 * An edit still invalidates the query, and an active observer refetches.
 */
export const reuseMountedRead = {
  refetchOnMount: false,
} as const satisfies ReuseMountedReadOptions;

export type { ArchivedListParam };

export function issuesListPath(archived?: ArchivedListParam): string {
  if (!archived) return "/api/issues";
  return `/api/issues?${new URLSearchParams({ archived }).toString()}`;
}

export function useIssuesQuery(
  archived?: ArchivedListParam,
  options?: { enabled?: boolean },
): UseQueryResult<IssuesResponse, Error> {
  return useQuery({
    queryKey: issuesKeys.list(archived),
    queryFn: () => request<IssuesResponse>(issuesListPath(archived)),
    enabled: options?.enabled ?? true,
    ...reuseMountedRead,
  });
}

/** Git worktree facts for a Project. May resolve after the issue list. */
export function useProjectWorktreesQuery(
  projectId: string,
): UseQueryResult<ProjectWorktreesResponse, Error> {
  return useQuery({
    queryKey: issuesKeys.projectWorktrees(projectId),
    queryFn: () =>
      request<ProjectWorktreesResponse>(
        `/api/projects/${encodeURIComponent(projectId)}/worktrees`,
      ),
    enabled: Boolean(projectId),
    ...reuseMountedRead,
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

export function useCommentsQuery(
  id: string,
  options: ReuseMountedReadOptions = {},
): UseQueryResult<CommentsResponse, Error> {
  return useQuery({
    queryKey: issuesKeys.comments(id),
    queryFn: () => request<CommentsResponse>(`/api/issues/${id}/comments`),
    enabled: Boolean(id),
    ...options,
    retry: (count, error) =>
      !(error instanceof ApiError && error.status === 404) && count < 2,
  });
}

/** Stored threads plus comments this browser posted that the list does not carry yet. */
export function useCommentThreads(
  issueId: string,
  options: ReuseMountedReadOptions = {},
): CommentThreadsResult {
  const { data } = useCommentsQuery(issueId, options);
  const outbox = useIssueCommentOutbox(issueId);
  const messages = data?.messages;
  useEffect(() => {
    if (!messages) return;
    useCommentOutboxStore
      .getState()
      .reconcile(issueId, storedClientIds(messages));
  }, [issueId, messages]);
  const threads = useMemo(
    () =>
      groupCommentThreads(
        withOutboxComments(messages ?? [], outbox),
        data?.threads ?? [],
      ),
    [messages, outbox, data?.threads],
  );
  return {
    threads,
    problems: data?.problems ?? [],
    loaded: data !== undefined,
  };
}

/** Diff and review panels reuse the comments read the page already started. */
export function useReuseCommentThreads(issueId: string): CommentThreadsResult {
  return useCommentThreads(issueId, reuseMountedRead);
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

/** Raw markdown for each reserved draft, in the same order as `names`. */
export function useExportDraftTexts(
  issueId: string,
  names: readonly string[],
): UseQueryResult<string, Error>[] {
  return useQueries({
    queries: names.map((name) => ({
      queryKey: [...issuesKeys.attachments(issueId), "draft", name] as const,
      queryFn: () => requestText(attachmentsApiPath(issueId, name)),
      enabled: Boolean(issueId),
    })),
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

export interface ProjectSecretKeysResponse {
  keys: string[];
}

/** Secret key names for a Project. The response never includes values. */
export function useProjectSecretKeys(
  projectId: string,
): UseQueryResult<ProjectSecretKeysResponse, Error> {
  return useQuery({
    queryKey: issuesKeys.projectSecrets(projectId),
    queryFn: () =>
      request<ProjectSecretKeysResponse>(
        `/api/projects/${encodeURIComponent(projectId)}/secrets`,
      ),
    enabled: Boolean(projectId),
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

export function issueChangeFileUrl(
  issueId: string,
  sha: string,
  path: string,
): string {
  const params = new URLSearchParams({ path, sha });
  return `/api/issues/${encodeURIComponent(issueId)}/change/file?${params}`;
}

export async function fetchIssueChangeFile(
  issueId: string,
  sha: string,
  path: string,
): Promise<string> {
  const { contents } = await request<{ contents: string }>(
    issueChangeFileUrl(issueId, sha, path),
  );
  return contents;
}

export function useIssueChangeFileQuery(
  issueId: string | undefined,
  sha: string | undefined,
  path: string | undefined,
): UseQueryResult<string, Error> {
  return useQuery({
    queryKey: issuesKeys.changeFile(issueId ?? "", sha ?? "", path ?? ""),
    queryFn: () => fetchIssueChangeFile(issueId!, sha!, path!),
    enabled: Boolean(issueId && sha && path),
    retry: (count, error) =>
      !(error instanceof ApiError && error.status >= 400 && error.status < 500) &&
      count < 2,
    staleTime: 60_000,
  });
}
