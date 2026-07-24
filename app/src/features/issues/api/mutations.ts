import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { request } from "@/lib/api/client";
import type {
  ChatMessage,
  ChatMessageInput,
  CreateInput,
  IssueDetail,
  IssuePatch,
  IssueRecord,
  IssuesResponse,
} from "@server/schemas";
import type { Attachment } from "@server/services/attachments";
import type { DeletionResult } from "@server/services/deletion";
import { subtreeIds } from "@server/services/subtree";
import { attachmentsApiPath } from "../lib/attachments";
import { issuesKeys } from "./keys";

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : "Request failed";
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

export function usePostMessage(id: string) {
  const qc = useQueryClient();
  return useMutation<ChatMessage, Error, ChatMessageInput>({
    mutationFn: (input) =>
      request<ChatMessage>(`/api/issues/${id}/messages`, {
        method: "POST",
        body: input,
      }),
    onError: (err) => toast.error(messageOf(err)),
    onSettled: () => qc.invalidateQueries({ queryKey: issuesKeys.chat(id) }),
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
        qc.removeQueries({ queryKey: issuesKeys.chat(deletedId) });
        qc.removeQueries({ queryKey: issuesKeys.attachments(deletedId) });
      }
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
