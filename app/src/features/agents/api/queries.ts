import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { ApiError } from "@/lib/api/errors";
import type { ConversationDetail, ConversationMeta } from "@server/schemas";
import {
  listAgentModels,
  listConversations,
  getConversation,
  type AgentModelsResponse,
} from "./client";
import { agentsKeys } from "./keys";

export function useConversationsQuery(): UseQueryResult<
  ConversationMeta[],
  Error
> {
  return useQuery({
    queryKey: agentsKeys.conversations(),
    queryFn: listConversations,
  });
}

export function useConversationQuery(
  id: string,
): UseQueryResult<ConversationDetail, Error> {
  return useQuery({
    queryKey: agentsKeys.conversation(id),
    queryFn: () => getConversation(id),
    enabled: Boolean(id),
    retry: (count, error) =>
      !(error instanceof ApiError && error.status === 404) && count < 2,
  });
}

export function useAgentModelsQuery(): UseQueryResult<
  AgentModelsResponse,
  Error
> {
  return useQuery({
    queryKey: agentsKeys.models(),
    queryFn: listAgentModels,
  });
}
