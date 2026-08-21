import { describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import type { ChannelSessionListItem } from "@server/schemas";
import { issuesKeys } from "../api/keys";
import {
  markChannelSessionActiveRun,
  markChannelSessionRetired,
  patchChannelSessionActiveRunInCache,
  retireChannelLiveSession,
} from "./retire-channel-live-session";
import { channelSessionListItem } from "../test/channel-session-list-item";

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
      channelSessionListItem({
        id: "live-1",
        title: "Plan",
        model: "composer-2.5",
        updatedAt: "2026-08-02T00:00:00.000Z",
        activeRun: true,
        awaitingHuman: false,
      }),
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

describe("markChannelSessionActiveRun", () => {
  it("patches activeRun on the matching session only", () => {
    const sessions: ChannelSessionListItem[] = [
      channelSessionListItem({
        id: "live-1",
        title: "Implement",
        model: "composer-2.5",
        updatedAt: "2026-08-02T00:00:00.000Z",
        activeRun: true,
        awaitingHuman: false,
      }),
      channelSessionListItem({
        id: "old-1",
        title: "Prior",
        model: "composer-2.5",
        archived: true,
      }),
    ];
    expect(markChannelSessionActiveRun(sessions, "live-1", false)).toEqual([
      { ...sessions[0]!, activeRun: false },
      sessions[1],
    ]);
  });
});

describe("patchChannelSessionActiveRunInCache", () => {
  it("updates every cached channel-sessions list that contains the session", () => {
    const qc = new QueryClient();
    const shipIt: ChannelSessionListItem[] = [
      channelSessionListItem({
        id: "live-1",
        title: "Implement Ship it",
        model: "composer-2.5",
        updatedAt: "2026-08-02T00:00:00.000Z",
        activeRun: true,
        awaitingHuman: false,
      }),
    ];
    qc.setQueryData(issuesKeys.channelSessions("ship-it", "implementing"), shipIt);
    patchChannelSessionActiveRunInCache(qc, "live-1", false);
    expect(
      qc.getQueryData<ChannelSessionListItem[]>(
        issuesKeys.channelSessions("ship-it", "implementing"),
      ),
    ).toEqual([{ ...shipIt[0]!, activeRun: false }]);
  });
});
