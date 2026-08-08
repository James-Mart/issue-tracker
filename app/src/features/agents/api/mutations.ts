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

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : "Request failed";
}

export function useCreateConversation() {
  const qc = useQueryClient();
  return useMutation<ConversationMeta, Error, CreateConversationBody>({
    mutationFn: createConversation,
    onError: (err) => toast.error(messageOf(err)),
    onSettled: () =>
      qc.invalidateQueries({ queryKey: agentsKeys.conversations() }),
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
      qc.invalidateQueries({ queryKey: agentsKeys.conversations() }),
  });
}

export function useDeleteConversation() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: deleteConversation,
    onError: (err) => toast.error(messageOf(err)),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: agentsKeys.conversations() });
    },
  });
}

export function useSendConversationMessage() {
  return useMutation<
    SendConversationMessageResult,
    Error,
    { id: string; body: SendConversationMessageBody }
  >({
    mutationFn: ({ id, body }) => sendConversationMessage(id, body),
    onError: (err) => toast.error(messageOf(err)),
  });
}

export function useCancelConversationRun() {
  return useMutation<void, Error, string>({
    mutationFn: cancelConversationRun,
    onError: (err) => toast.error(messageOf(err)),
  });
}

export function useInterruptConversationRun() {
  return useMutation<
    InterruptConversationRunResult,
    Error,
    { id: string; body: InterruptConversationRunBody }
  >({
    mutationFn: ({ id, body }) => interruptConversationRun(id, body),
    onError: (err) => toast.error(messageOf(err)),
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
      qc.invalidateQueries({ queryKey: agentsKeys.conversations() }),
  });
}

export function useClearConversationPending() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: clearConversationPending,
    onError: (err) => toast.error(messageOf(err)),
    onSettled: () =>
      qc.invalidateQueries({ queryKey: agentsKeys.conversations() }),
  });
}
