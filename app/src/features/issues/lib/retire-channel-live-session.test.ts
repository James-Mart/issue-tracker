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

describe("markChannelSessionActiveRun", () => {
  it("patches activeRun on the matching session only", () => {
    const sessions: ChannelSessionListItem[] = [
      {
        id: "live-1",
        title: "Implement",
        model: "composer-2.5",
        createdAt: "2026-08-02T00:00:00.000Z",
        updatedAt: "2026-08-02T00:00:00.000Z",
        archived: false,
        activeRun: true,
      },
      {
        id: "old-1",
        title: "Prior",
        model: "composer-2.5",
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z",
        archived: true,
        activeRun: false,
      },
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
      {
        id: "live-1",
        title: "Implement Ship it",
        model: "composer-2.5",
        createdAt: "2026-08-02T00:00:00.000Z",
        updatedAt: "2026-08-02T00:00:00.000Z",
        archived: false,
        activeRun: true,
      },
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
