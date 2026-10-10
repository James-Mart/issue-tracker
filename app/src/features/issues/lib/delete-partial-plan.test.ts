import { beforeEach, describe, expect, it, vi } from "vitest";
import { deleteConversation } from "@/features/agents/api/client";
import { listChannelSessions } from "../api/channel-sessions";
import { deletePartialPlanSessions } from "./delete-partial-plan";
import { channelSessionListItem } from "../test/channel-session-list-item";

vi.mock("../api/channel-sessions", () => ({
  listChannelSessions: vi.fn(),
}));

vi.mock("@/features/agents/api/client", () => ({
  deleteConversation: vi.fn(),
}));

const listSessions = vi.mocked(listChannelSessions);
const deleteSession = vi.mocked(deleteConversation);

describe("deletePartialPlanSessions", () => {
  beforeEach(() => {
    listSessions.mockReset();
    deleteSession.mockReset();
  });

  it("lists planning sessions then deletes each in list order", async () => {
    listSessions.mockResolvedValue([
      channelSessionListItem({
        id: "live",
        title: "Live",
        model: "composer-2.5",
        updatedAt: "2026-08-02T00:00:00.000Z",
      }),
      channelSessionListItem({
        id: "archived",
        title: "Old",
        model: "composer-2.5",
        archived: true,
      }),
    ]);
    deleteSession.mockResolvedValue(undefined);

    await deletePartialPlanSessions("stalled-idea");

    expect(listSessions).toHaveBeenCalledWith("stalled-idea", "planning");
    expect(deleteSession).toHaveBeenCalledTimes(2);
    expect(deleteSession.mock.calls[0]?.[0]).toBe("live");
    expect(deleteSession.mock.calls[1]?.[0]).toBe("archived");
  });
});
