import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { request } from "@/lib/api/client";
import type { ChatResponse, IssueDetail, IssuesResponse } from "@server/schemas";
import type { Attachment } from "@server/services/attachments";
import { ApiError } from "@/lib/api/errors";
import { attachmentsApiPath } from "../lib/attachments";
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

export function useChatQuery(id: string): UseQueryResult<ChatResponse, Error> {
  return useQuery({
    queryKey: issuesKeys.chat(id),
    queryFn: () => request<ChatResponse>(`/api/issues/${id}/chat`),
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
