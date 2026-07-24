import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { ConversationMeta } from "@server/schemas";
import {
  createConversation,
  deleteConversation,
  updateConversation,
  type CreateConversationBody,
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
    onSuccess: (data) =>
      qc.setQueryData(agentsKeys.conversation(data.id), (prev) =>
        prev && typeof prev === "object" && "meta" in prev
          ? { ...prev, meta: data }
          : prev,
      ),
    onSettled: () =>
      qc.invalidateQueries({ queryKey: agentsKeys.conversations() }),
  });
}

export function useDeleteConversation() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: deleteConversation,
    onError: (err) => toast.error(messageOf(err)),
    onSettled: (_data, _err, id) => {
      qc.invalidateQueries({ queryKey: agentsKeys.conversations() });
      qc.removeQueries({ queryKey: agentsKeys.conversation(id) });
    },
  });
}
