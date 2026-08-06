import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { ConversationListItem } from "@server/schemas";
import {
  listAgentModels,
  listConversations,
  type AgentModelsResponse,
} from "./client";
import { agentsKeys } from "./keys";

export function useConversationsQuery(): UseQueryResult<
  ConversationListItem[],
  Error
> {
  return useQuery({
    queryKey: agentsKeys.conversations(),
    queryFn: listConversations,
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
