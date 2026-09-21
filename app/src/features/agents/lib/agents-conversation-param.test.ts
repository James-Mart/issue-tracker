import { describe, expect, it } from "vitest";
import type { ConversationListItem } from "@server/schemas";
import { resolveAgentsConversationParam } from "./agents-conversation-param";

function conversation(
  overrides: Partial<ConversationListItem> & Pick<ConversationListItem, "id">,
): ConversationListItem {
  return {
    title: overrides.title ?? overrides.id,
    projectId: "issue-tracker",
    model: "composer-2.5-fast",
    activeRun: false,
    archived: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const present = conversation({ id: "conv-1" });
const archived = conversation({ id: "conv-archived", archived: true });
const roster = [present, archived];

describe("resolveAgentsConversationParam", () => {
  it("opens an id that is present without revealing archived or replacing", () => {
    expect(resolveAgentsConversationParam("conv-1", roster)).toEqual({
      selectedId: "conv-1",
      revealArchived: false,
      replaceWithRoster: false,
    });
  });

  it("replaces an id that is absent", () => {
    expect(resolveAgentsConversationParam("does-not-exist", roster)).toEqual({
      selectedId: null,
      revealArchived: false,
      replaceWithRoster: true,
    });
  });

  it("opens an archived id and asks the roster to reveal archived rows", () => {
    expect(resolveAgentsConversationParam("conv-archived", roster)).toEqual({
      selectedId: "conv-archived",
      revealArchived: true,
      replaceWithRoster: false,
    });
  });

  it("makes no decision while the list is still loading", () => {
    expect(resolveAgentsConversationParam("conv-1", undefined)).toEqual({
      selectedId: null,
      revealArchived: false,
      replaceWithRoster: false,
    });
  });
});
