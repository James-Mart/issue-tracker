import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { request } from "@/lib/api/client";
import type {
  ChannelSessionListItem,
  CommentsResponse,
  ConversationChannel,
  IssueDetail,
  IssuesResponse,
} from "@server/schemas";
import type { Attachment } from "@server/services/attachments";
import { ApiError } from "@/lib/api/errors";
import { attachmentsApiPath } from "../lib/attachments";
import { listChannelSessions } from "./channel-sessions";
import { issuesKeys } from "./keys";

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
