import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { ConversationMeta } from "@server/schemas";
import {
  cancelConversationRun,
  clearConversationPending,
  createConversation,
  deleteConversation,
  interruptConversationRun,
  sendConversationMessage,
  updateConversation,
  updateConversationPending,
  type CreateConversationBody,
  type InterruptConversationRunBody,
  type InterruptConversationRunResult,
  type SendConversationMessageBody,
  type SendConversationMessageResult,
  type UpdateConversationBody,
} from "./client";
import { agentsKeys } from "./keys";
import { patchChannelSessionActiveRunInCache } from "@/features/issues/lib/retire-channel-live-session";

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : "Request failed";
}

export function useCreateConversation() {
  const qc = useQueryClient();
  return useMutation<ConversationMeta, Error, CreateConversationBody>({
    mutationFn: createConversation,
    onError: (err) => toast.error(messageOf(err)),
    onSettled: () =>
      qc.invalidateQueries({ queryKey: agentsKeys.conversationsPrefix() }),
  });
}

export function useUpdateConversation() {
  const qc = useQueryClient();
  return useMutation<
    ConversationMeta,
    Error,
    { id: string; patch: UpdateConversationBody }
  >({
    mutationFn: ({ id, patch }) => updateConversation(id, patch),
    onError: (err) => toast.error(messageOf(err)),
    onSettled: () =>
      qc.invalidateQueries({ queryKey: agentsKeys.conversationsPrefix() }),
  });
}

export function useDeleteConversation() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: deleteConversation,
    onError: (err) => toast.error(messageOf(err)),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: agentsKeys.conversationsPrefix() });
    },
  });
}

export function useSendConversationMessage() {
  const qc = useQueryClient();
  return useMutation<
    SendConversationMessageResult,
    Error,
    { id: string; body: SendConversationMessageBody }
  >({
    mutationFn: ({ id, body }) => sendConversationMessage(id, body),
    onError: (err) => toast.error(messageOf(err)),
    onSuccess: (result, { id }) => {
      if (result.runId) {
        patchChannelSessionActiveRunInCache(qc, id, true);
      }
    },
  });
}

export function useCancelConversationRun() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: cancelConversationRun,
    onError: (err) => toast.error(messageOf(err)),
    onSuccess: (_data, conversationId) => {
      patchChannelSessionActiveRunInCache(qc, conversationId, false);
    },
  });
}

export function useInterruptConversationRun() {
  const qc = useQueryClient();
  return useMutation<
    InterruptConversationRunResult,
    Error,
    { id: string; body: InterruptConversationRunBody }
  >({
    mutationFn: ({ id, body }) => interruptConversationRun(id, body),
    onError: (err) => toast.error(messageOf(err)),
    onSuccess: (_result, { id }) => {
      patchChannelSessionActiveRunInCache(qc, id, true);
    },
  });
}

export function useUpdateConversationPending() {
  const qc = useQueryClient();
  return useMutation<
    ConversationMeta,
    Error,
    { id: string; text: string }
  >({
    mutationFn: ({ id, text }) => updateConversationPending(id, { text }),
    onError: (err) => toast.error(messageOf(err)),
    onSettled: () =>
      qc.invalidateQueries({ queryKey: agentsKeys.conversationsPrefix() }),
  });
}

export function useClearConversationPending() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: clearConversationPending,
    onError: (err) => toast.error(messageOf(err)),
    onSettled: () =>
      qc.invalidateQueries({ queryKey: agentsKeys.conversationsPrefix() }),
  });
}
