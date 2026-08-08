import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { ConversationListItem } from "@server/schemas";
import {
  listAgentModels,
  listConversations,
  type AgentModelsResponse,
} from "./client";
import { agentsKeys } from "./keys";

/** Poll so closed-thread runs clear without an open SSE subscription. */
const CONVERSATIONS_REFETCH_INTERVAL_MS = 15_000;

export function useConversationsQuery(
  showArchived = false,
): UseQueryResult<ConversationListItem[], Error> {
  return useQuery({
    queryKey: agentsKeys.conversations(showArchived),
    queryFn: () => listConversations(showArchived),
    refetchOnWindowFocus: true,
    refetchInterval: CONVERSATIONS_REFETCH_INTERVAL_MS,
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
