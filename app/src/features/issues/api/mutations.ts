import { useCallback } from "react";
import {
  useMutation,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import { deleteConversation } from "@/features/agents/api/client";
import { agentsKeys } from "@/features/agents/api/keys";
import { request, requestText } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import {
  createChannelSession,
  type CreateChannelSessionBody,
  type CreateChannelSessionResult,
} from "./channel-sessions";
import type {
  ChannelSessionListItem,
  Comment,
  CommentInput,
  CommentMessage,
  CommentsResponse,
  ConversationChannel,
  CreateInput,
  IssueDetail,
  IssuePatch,
  IssueRecord,
  IssuesResponse,
  MergeStoryBody,
  ThreadEventRequest,
  ThreadView,
} from "@server/schemas";
import type { Attachment } from "@server/services/attachments";
import type { DeletionResult } from "@server/services/deletion";
import { subtreeIds } from "@server/services/subtree";
import { attachmentsApiPath } from "../lib/attachments";
import type { OutboxComment } from "../lib/comment-outbox";
import { useCommentEditStore } from "../store/use-comment-edit-store";
import { useCommentOutboxStore } from "../store/use-comment-outbox-store";
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

export function useUpdateFromMergeBase(storyId: string) {
  const qc = useQueryClient();
  return useMutation<IssueRecord, Error, void>({
    mutationFn: () =>
      request<IssueRecord>(
        `/api/issues/${encodeURIComponent(storyId)}/update-from-merge-base`,
        { method: "POST" },
      ),
    onError: (err) => toast.error(messageOf(err)),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: issuesKeys.list() });
      qc.invalidateQueries({ queryKey: issuesKeys.detail(storyId) });
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

export function usePostThreadEvent(issueId: string) {
  const qc = useQueryClient();
  return useMutation<
    { thread: ThreadView },
    Error,
    {
      threadId: string;
      event: ThreadEventRequest["event"];
      body?: string;
    }
  >({
    mutationFn: ({ threadId, event, body }) =>
      request(`/api/issues/${issueId}/threads/${threadId}/events`, {
        method: "POST",
        body: body === undefined ? { event } : { event, body },
      }),
    onError: (err) => toast.error(messageOf(err)),
    onSettled: () =>
      qc.invalidateQueries({ queryKey: issuesKeys.comments(issueId) }),
  });
}

export function useRetryQuestionResearcher(storyId: string) {
  const qc = useQueryClient();
  return useMutation<void, Error, string, { previous?: CommentsResponse }>({
    mutationFn: (threadId) =>
      request(`/api/issues/${storyId}/threads/${threadId}/researcher/retry`, {
        method: "POST",
      }),
    onMutate: async (threadId) => {
      await qc.cancelQueries({ queryKey: issuesKeys.comments(storyId) });
      const previous = qc.getQueryData<CommentsResponse>(
        issuesKeys.comments(storyId),
      );
      const startedAt = new Date().toISOString();
      qc.setQueryData<CommentsResponse>(issuesKeys.comments(storyId), (current) => {
        if (!current) return current;
        return {
          ...current,
          threads: current.threads.map((thread) =>
            thread.rootId === threadId
              ? { ...thread, researcherRun: { status: "running", startedAt } }
              : thread,
          ),
        };
      });
      return { previous };
    },
    onError: (err, _threadId, context) => {
      if (context?.previous) {
        qc.setQueryData(issuesKeys.comments(storyId), context.previous);
      }
      toast.error(messageOf(err));
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: issuesKeys.comments(storyId) });
      qc.invalidateQueries({ queryKey: issuesKeys.agentRuns(storyId) });
    },
  });
}

async function deliverComment(qc: QueryClient, entry: OutboxComment): Promise<void> {
  const { setDelivery } = useCommentOutboxStore.getState();
  try {
    await request<Comment>(`/api/issues/${entry.issueId}/comments`, {
      method: "POST",
      body: entry.input,
    });
    setDelivery(entry.clientId, { status: "sent" });
  } catch (err) {
    setDelivery(entry.clientId, { status: "failed", error: messageOf(err) });
  } finally {
    // A post that failed in transit may still have been stored; the list reconciles it.
    void qc.invalidateQueries({ queryKey: issuesKeys.comments(entry.issueId) });
  }
}

/**
 * Post a comment from this browser. It shows in its thread at once; a failed
 * post stays there with its error until it is resent.
 */
export function usePostComment(issueId: string): (input: CommentInput) => void {
  const qc = useQueryClient();
  return useCallback(
    (input) => {
      const clientId = crypto.randomUUID();
      const entry: OutboxComment = {
        issueId,
        clientId,
        input: { ...input, clientId },
        at: new Date().toISOString(),
        delivery: { status: "sending" },
      };
      useCommentOutboxStore.getState().enqueue(entry);
      void deliverComment(qc, entry);
    },
    [issueId, qc],
  );
}

/**
 * Save an edit to a pending review comment. The comments cache shows the new
 * body at once. A refusal puts the previous body back and records an inline
 * error for that comment.
 */
export function useEditComment(issueId: string) {
  const qc = useQueryClient();
  return useMutation<
    CommentMessage,
    Error,
    { commentId: string; body: string },
    { priorBody?: string }
  >({
    mutationFn: ({ commentId, body }) =>
      request<CommentMessage>(
        `/api/issues/${issueId}/comments/${commentId}`,
        { method: "PATCH", body: { body } },
      ),
    onMutate: async ({ commentId, body }) => {
      const edits = useCommentEditStore.getState();
      edits.begin(commentId);
      const key = issuesKeys.comments(issueId);
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<CommentsResponse>(key);
      const priorBody = previous?.messages.find(
        (message) => message.id === commentId,
      )?.body;
      if (previous && priorBody !== undefined) {
        qc.setQueryData<CommentsResponse>(key, {
          ...previous,
          messages: previous.messages.map((message) =>
            message.id === commentId ? { ...message, body } : message,
          ),
        });
      }
      return { priorBody };
    },
    onError: (err, vars, context) => {
      const key = issuesKeys.comments(issueId);
      const current = qc.getQueryData<CommentsResponse>(key);
      const priorBody = context?.priorBody;
      const message = current?.messages.find((item) => item.id === vars.commentId);
      if (current && priorBody !== undefined && message?.body === vars.body) {
        qc.setQueryData<CommentsResponse>(key, {
          ...current,
          messages: current.messages.map((item) =>
            item.id === vars.commentId ? { ...item, body: priorBody } : item,
          ),
        });
      }
      useCommentEditStore.getState().fail(vars.commentId, messageOf(err));
    },
    onSuccess: (_data, vars) => {
      useCommentEditStore.getState().clearError(vars.commentId);
    },
    onSettled: (_data, _err, vars) => {
      useCommentEditStore.getState().end(vars.commentId);
      void qc.invalidateQueries({ queryKey: issuesKeys.comments(issueId) });
    },
  });
}

/** Resend a failed comment with the same body and client id. */
export function useResendComment(): (clientId: string) => void {
  const qc = useQueryClient();
  return useCallback(
    (clientId) => {
      const outbox = useCommentOutboxStore.getState();
      const entry = outbox.byClientId[clientId];
      // Gone when a refetch showed the failed post was stored after all.
      if (!entry) return;
      outbox.setDelivery(clientId, { status: "sending" });
      void deliverComment(qc, entry);
    },
    [qc],
  );
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

/** Last-pass edit: overwrite one reserved `github-export-*` basename. */
export function useOverwriteExportDraft(issueId: string) {
  const qc = useQueryClient();
  return useMutation<string, Error, { name: string; content: string }>({
    mutationFn: ({ name, content }) =>
      requestText(attachmentsApiPath(issueId, name), {
        method: "PUT",
        headers: { "Content-Type": "text/markdown" },
        body: content,
      }),
    onError: (err) => toast.error(messageOf(err)),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: issuesKeys.attachments(issueId) });
    },
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
        awaitingHuman: false,
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
      void qc.invalidateQueries({ queryKey: issuesKeys.list() });
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

function isConflict(err: unknown): boolean {
  return err instanceof ApiError && err.status === 409;
}

export function useRemoveStoryWorktree(storyId: string) {
  const qc = useQueryClient();
  return useMutation<void, Error, { discard?: boolean } | void>({
    mutationFn: (input) =>
      request<void>(
        `/api/issues/${encodeURIComponent(storyId)}/worktree/remove`,
        {
          method: "POST",
          body: input?.discard === true ? { discard: true } : {},
        },
      ),
    onError: (err) => {
      if (isConflict(err)) return;
      toast.error(messageOf(err));
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: issuesKeys.list() });
      qc.invalidateQueries({ queryKey: issuesKeys.projectWorktreesAll() });
      qc.invalidateQueries({ queryKey: issuesKeys.detail(storyId) });
    },
  });
}

export function useSetupStoryWorktree(storyId: string) {
  const qc = useQueryClient();
  return useMutation<void, Error, void>({
    mutationFn: () =>
      request<void>(
        `/api/issues/${encodeURIComponent(storyId)}/worktree/setup`,
        { method: "POST" },
      ),
    onError: (err) => {
      if (isConflict(err)) return;
      toast.error(messageOf(err));
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: issuesKeys.list() });
      qc.invalidateQueries({ queryKey: issuesKeys.projectWorktreesAll() });
      qc.invalidateQueries({ queryKey: issuesKeys.detail(storyId) });
    },
  });
}

type SecretKeyList = { keys: string[] };

/**
 * Set or replace one Project secret. The value is dropped from the mutation
 * cache when the request settles so client state keeps key names only.
 */
export function useSetProjectSecret(projectId: string) {
  const qc = useQueryClient();
  const mutation = useMutation<SecretKeyList, Error, { key: string; value: string }>({
    mutationFn: ({ key, value }) =>
      request<SecretKeyList>(
        `/api/projects/${encodeURIComponent(projectId)}/secrets/${encodeURIComponent(key)}`,
        { method: "PUT", body: { value } },
      ),
    onError: (err) => toast.error(messageOf(err)),
    onSuccess: (data) => {
      qc.setQueryData(issuesKeys.projectSecrets(projectId), { keys: data.keys });
    },
  });

  return {
    isPending: mutation.isPending,
    mutateAsync: async (input: { key: string; value: string }) => {
      try {
        return await mutation.mutateAsync(input);
      } finally {
        mutation.reset();
      }
    },
  };
}

/** Remove one Project secret. The response is key names only. */
export function useDeleteProjectSecret(projectId: string) {
  const qc = useQueryClient();
  return useMutation<SecretKeyList, Error, string>({
    mutationFn: (key) =>
      request<SecretKeyList>(
        `/api/projects/${encodeURIComponent(projectId)}/secrets/${encodeURIComponent(key)}`,
        { method: "DELETE" },
      ),
    onError: (err) => toast.error(messageOf(err)),
    onSuccess: (data) => {
      qc.setQueryData(issuesKeys.projectSecrets(projectId), { keys: data.keys });
    },
  });
}

/** Clear Story `review` after the human finishes the open validator request. */
export function useHumanDone(storyId: string) {
  const qc = useQueryClient();
  return useMutation<Comment, Error, { note?: string }>({
    mutationFn: (input) =>
      request<Comment>(
        `/api/stories/${encodeURIComponent(storyId)}/human-done`,
        {
          method: "POST",
          body: input.note === undefined ? {} : { note: input.note },
        },
      ),
    onError: (err) => toast.error(messageOf(err)),
    onSuccess: (message) => {
      qc.setQueryData<CommentsResponse>(issuesKeys.comments(storyId), (current) => {
        if (!current) return current;
        if (current.messages.some((entry) => entry.id === message.id)) return current;
        return { ...current, messages: [...current.messages, message] };
      });
      qc.setQueryData<IssueDetail>(issuesKeys.detail(storyId), (current) => {
        if (!current || current.kind !== "story") return current;
        return { ...current, review: undefined };
      });
      qc.setQueryData<IssuesResponse>(issuesKeys.list(), (current) => {
        if (!current) return current;
        return {
          ...current,
          issues: current.issues.map((issue) =>
            issue.id === storyId && issue.kind === "story"
              ? { ...issue, review: undefined }
              : issue,
          ),
        };
      });
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: issuesKeys.detail(storyId) });
      qc.invalidateQueries({ queryKey: issuesKeys.comments(storyId) });
      qc.invalidateQueries({ queryKey: issuesKeys.list() });
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
