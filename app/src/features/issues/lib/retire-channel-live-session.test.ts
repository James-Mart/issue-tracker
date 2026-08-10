import { describe, expect, it, vi } from "vitest";
import type { ChannelSessionListItem } from "@server/schemas";
import {
  markChannelSessionRetired,
  retireChannelLiveSession,
} from "./retire-channel-live-session";

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

describe("markChannelSessionRetired", () => {
  it("marks the matching session archived and idle", () => {
    const sessions: ChannelSessionListItem[] = [
      {
        id: "live-1",
        title: "Plan",
        model: "composer-2.5",
        createdAt: "2026-08-02T00:00:00.000Z",
        updatedAt: "2026-08-02T00:00:00.000Z",
        archived: false,
        activeRun: true,
      },
    ];
    expect(markChannelSessionRetired(sessions, "live-1")).toEqual([
      {
        ...sessions[0],
        archived: true,
        activeRun: false,
      },
    ]);
  });
});
