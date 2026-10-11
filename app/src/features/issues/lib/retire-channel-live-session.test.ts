import { describe, expect, it, vi } from "vitest";
import { retireChannelLiveSession } from "./retire-channel-live-session";

const cancelConversationRun = vi.hoisted(() => vi.fn());
const updateConversation = vi.hoisted(() => vi.fn());

vi.mock("@/features/agents/api/client", () => ({
  cancelConversationRun,
  updateConversation,
}));

describe("retireChannelLiveSession", () => {
  it("cancels the run then PATCH-archives the conversation", async () => {
    cancelConversationRun.mockResolvedValue(undefined);
    updateConversation.mockResolvedValue({});

    await retireChannelLiveSession("live-1");

    expect(cancelConversationRun).toHaveBeenCalledWith("live-1");
    expect(updateConversation).toHaveBeenCalledWith("live-1", {
      archived: true,
    });
  });
});
