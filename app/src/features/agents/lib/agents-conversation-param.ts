import type { ConversationListItem } from "@server/schemas";

export type AgentsConversationParamResolution = {
  selectedId: string | null;
  /** Set when the roster is loaded and the param id matches a conversation. */
  selectedConversation?: ConversationListItem;
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
    selectedConversation: found,
    revealArchived: found.archived,
    replaceWithRoster: false,
  };
}

/**
 * Review runs are real conversations and are omitted from the roster. Hold
 * the URL open until a lookup says the id is missing.
 */
export function holdOffRosterConversation(
  paramId: string | undefined,
  resolution: AgentsConversationParamResolution,
  lookup: "pending" | "found" | "missing" | "failed",
): { selectedId: string | null; replaceWithRoster: boolean } {
  if (!resolution.replaceWithRoster || paramId === undefined) {
    return {
      selectedId: resolution.selectedId,
      replaceWithRoster: resolution.replaceWithRoster,
    };
  }
  if (lookup === "missing") {
    return { selectedId: null, replaceWithRoster: true };
  }
  return { selectedId: paramId, replaceWithRoster: false };
}
