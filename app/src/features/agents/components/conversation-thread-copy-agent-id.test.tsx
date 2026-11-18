// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import {
  mountThread,
  rosterConversations,
  setConversationDetailForTest,
} from "./conversation-thread.test-helpers";

describe("ConversationThread copy root agent id", () => {
  it("loads agentId from conversation detail when the thread is off the roster", () => {
    rosterConversations.length = 0;
    setConversationDetailForTest({
      meta: {
        title: "Channel session",
        model: "composer-2.5-fast",
        agentId: "agent-channel-9",
      },
    });
    const container = mountThread("channel-session-1");
    const button = container.querySelector('[data-testid="copy-root-agent-id"]');
    expect(button).toBeTruthy();
  });
});