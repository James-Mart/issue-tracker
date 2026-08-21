import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { request } from "@/lib/api/client";
import { deleteConversation } from "@/features/agents/api/client";
import { agentsKeys } from "@/features/agents/api/keys";
import {
  createChannelSession,
  type CreateChannelSessionBody,
  type CreateChannelSessionResult,
} from "./channel-sessions";
import type {
  ChannelSessionListItem,
  Comment,
  CommentInput,
  ConversationChannel,
  CreateInput,
  IssueDetail,
  IssuePatch,
  IssueRecord,
  IssuesResponse,
  MergeStoryBody,
} from "@server/schemas";
import type { Attachment } from "@server/services/attachments";
import type { DeletionResult } from "@server/services/deletion";
import { subtreeIds } from "@server/services/subtree";
import { attachmentsApiPath } from "../lib/attachments";
import { deletePartialPlanSessions } from "../lib/delete-partial-plan";
import { parseRunsInFlightRefusal } from "../lib/restart-refusal";
import { issuesKeys } from "./keys";

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : "Request failed";
}

export type RestartProcessInput = { force?: boolean };

export function useRestartProcess() {
  return useMutation<{ bootId: string }, Error, RestartProcessInput | void>({
    mutationFn: (input) =>
      request<{ bootId: string }>("/api/restart", {
        method: "POST",
        ...(input?.force ? { body: { force: true } } : {}),
      }),
    onError: (err) => {
      if (parseRunsInFlightRefusal(err)) return;
      toast.error(messageOf(err));
    },
  });
}

export function useCreateIssue() {
  const qc = useQueryClient();
  return useMutation<IssueRecord, Error, CreateInput>({
    mutationFn: (input) =>
      request<IssueRecord>("/api/issues", { method: "POST", body: input }),
    onError: (err) => toast.error(messageOf(err)),
    onSettled: () => qc.invalidateQueries({ queryKey: issuesKeys.list() }),
  });
}

export function useUpdateIssue() {
  const qc = useQueryClient();
  return useMutation<IssueDetail, Error, { id: string; patch: IssuePatch }>({
    mutationFn: ({ id, patch }) =>
      request<IssueDetail>(`/api/issues/${id}`, {
        method: "PATCH",
        body: patch,
      }),
    onError: (err) => toast.error(messageOf(err)),
    onSuccess: (data) => qc.setQueryData(issuesKeys.detail(data.id), data),
    onSettled: async (_data, _err, vars) => {
      if (vars?.patch.archived === undefined) {
        qc.invalidateQueries({ queryKey: issuesKeys.list() });
        return;
      }
      // Archive cascade updates the subtree on disk — await one list resync
      // and refresh detail caches for every affected id so child views do not
      // lag behind the patched root.
      const list = qc.getQueryData<IssuesResponse>(issuesKeys.list());
      const affected = list
        ? subtreeIds(list.issues, vars.id)
        : new Set([vars.id]);
      await qc.invalidateQueries({ queryKey: issuesKeys.list() });
      await Promise.all(
        [...affected].map((id) =>
          qc.invalidateQueries({ queryKey: issuesKeys.detail(id) }),
        ),
      );
    },
  });
}

export function usePostComment(id: string) {
  const qc = useQueryClient();
  return useMutation<Comment, Error, CommentInput>({
    mutationFn: (input) =>
      request<Comment>(`/api/issues/${id}/comments`, {
        method: "POST",
        body: input,
      }),
    onError: (err) => toast.error(messageOf(err)),
    onSettled: () => qc.invalidateQueries({ queryKey: issuesKeys.comments(id) }),
  });
}

export function useDeleteIssue() {
  const qc = useQueryClient();
  return useMutation<DeletionResult, Error, string>({
    mutationFn: (id) =>
      request<DeletionResult>(`/api/issues/${id}`, { method: "DELETE" }),
    onError: (err) => toast.error(messageOf(err)),
    onSettled: (data, _err, id) => {
      qc.invalidateQueries({ queryKey: issuesKeys.list() });
      for (const deletedId of data?.deleted ?? [id]) {
        qc.removeQueries({ queryKey: issuesKeys.detail(deletedId) });
        qc.removeQueries({ queryKey: issuesKeys.comments(deletedId) });
        qc.removeQueries({ queryKey: issuesKeys.attachments(deletedId) });
      }
    },
  });
}

export function useMergeStory(projectId: string) {
  const qc = useQueryClient();
  return useMutation<
    void,
    Error,
    { id: string } & MergeStoryBody
  >({
    mutationFn: ({ id, ...body }) =>
      request<void>(`/api/issues/${encodeURIComponent(id)}/merge`, {
        method: "POST",
        body,
      }),
    onError: (err) => toast.error(messageOf(err)),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({
        queryKey: issuesKeys.projectPullRequests(projectId),
      });
      void qc.invalidateQueries({ queryKey: issuesKeys.list() });
      void qc.invalidateQueries({ queryKey: issuesKeys.detail(vars.id) });
    },
  });
}

export function useUploadAttachment(id: string) {
  const qc = useQueryClient();
  return useMutation<Attachment, Error, File>({
    mutationFn: (file) => {
      const form = new FormData();
      form.append("file", file);
      return request<Attachment>(attachmentsApiPath(id), {
        method: "POST",
        body: form,
      });
    },
    onError: (err) => toast.error(messageOf(err)),
    onSettled: () =>
      qc.invalidateQueries({ queryKey: issuesKeys.attachments(id) }),
  });
}

export function useDeleteAttachment(id: string) {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (name) =>
      request<void>(attachmentsApiPath(id, name), { method: "DELETE" }),
    onError: (err) => toast.error(messageOf(err)),
    onSettled: () =>
      qc.invalidateQueries({ queryKey: issuesKeys.attachments(id) }),
  });
}

export interface MoveStoryResult {
  moved: string[];
}

export function useMoveStory() {
  const qc = useQueryClient();
  return useMutation<
    MoveStoryResult,
    Error,
    { id: string; target: string }
  >({
    mutationFn: ({ id, target }) =>
      request<MoveStoryResult>(`/api/issues/${id}/move-story`, {
        method: "POST",
        body: { target },
      }),
    onError: (err) => toast.error(messageOf(err)),
    onSettled: () => qc.invalidateQueries({ queryKey: issuesKeys.list() }),
  });
}

export interface ReorderBoardResult {
  order: string[];
}

export function useReorderBoardChild() {
  const qc = useQueryClient();
  return useMutation<
    ReorderBoardResult,
    Error,
    { id: string; before: string }
  >({
    mutationFn: ({ id, before }) =>
      request<ReorderBoardResult>(`/api/issues/${id}/reorder`, {
        method: "POST",
        body: { before },
      }),
    onError: (err) => toast.error(messageOf(err)),
    onSettled: () => qc.invalidateQueries({ queryKey: issuesKeys.list() }),
  });
}

export function useCreateChannelSession(
  issueId: string,
  channel: ConversationChannel,
  options?: { suppressToast?: (err: Error) => boolean },
) {
  const qc = useQueryClient();
  return useMutation<
    CreateChannelSessionResult,
    Error,
    CreateChannelSessionBody
  >({
    mutationFn: (body) => createChannelSession(issueId, channel, body),
    onError: (err) => {
      if (options?.suppressToast?.(err)) return;
      toast.error(messageOf(err));
    },
    onSuccess: (data, variables) => {
      const now = new Date().toISOString();
      const created: ChannelSessionListItem = {
        id: data.id,
        title: variables.title,
        model: variables.model,
        createdAt: now,
        updatedAt: now,
        archived: false,
        activeRun: true,
      };
      qc.setQueryData<ChannelSessionListItem[]>(
        issuesKeys.channelSessions(issueId, channel),
        (prev) => {
          const rest = (prev ?? [])
            .filter((session) => session.id !== data.id)
            .map((session) =>
              session.archived ? session : { ...session, archived: true },
            );
          return [created, ...rest];
        },
      );
    },
    onSettled: () => {
      qc.invalidateQueries({
        queryKey: issuesKeys.channelSessions(issueId, channel),
      });
      qc.invalidateQueries({ queryKey: agentsKeys.conversationsPrefix() });
    },
  });
}

export function useDeleteChannelSession(
  issueId: string,
  channel: ConversationChannel,
) {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: deleteConversation,
    onError: (err) => toast.error(messageOf(err)),
    onSettled: () => {
      qc.invalidateQueries({
        queryKey: issuesKeys.channelSessions(issueId, channel),
      });
      qc.invalidateQueries({ queryKey: agentsKeys.conversationsPrefix() });
    },
  });
}

export function useDeletePartialPlan(issueId: string) {
  const qc = useQueryClient();
  return useMutation<void, Error, void>({
    mutationFn: () => deletePartialPlanSessions(issueId),
    onError: (err) => toast.error(messageOf(err)),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: issuesKeys.list() });
      qc.invalidateQueries({
        queryKey: issuesKeys.channelSessions(issueId, "planning"),
      });
      qc.invalidateQueries({ queryKey: agentsKeys.conversationsPrefix() });
    },
  });
}
