import type { ConversationListItem } from "@server/schemas";

export type AgentsConversationParamResolution = {
  selectedId: string | null;
  revealArchived: boolean;
  replaceWithRoster: boolean;
};

const NO_DECISION: AgentsConversationParamResolution = {
  selectedId: null,
  revealArchived: false,
  replaceWithRoster: false,
};

/**
 * Resolve a `/agents/:conversationId` segment against the roster.
 * `conversations` is `undefined` while the list is still loading — that is
 * not treated as a missing conversation.
 */
export function resolveAgentsConversationParam(
  paramId: string | undefined,
  conversations: ConversationListItem[] | undefined,
): AgentsConversationParamResolution {
  if (conversations === undefined || paramId === undefined) {
    return NO_DECISION;
  }
  const found = conversations.find((conversation) => conversation.id === paramId);
  if (!found) {
    return {
      selectedId: null,
      revealArchived: false,
      replaceWithRoster: true,
    };
  }
  return {
    selectedId: found.id,
    revealArchived: found.archived,
    replaceWithRoster: false,
  };
}
