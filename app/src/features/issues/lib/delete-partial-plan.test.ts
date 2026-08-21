import { beforeEach, describe, expect, it, vi } from "vitest";
import { deleteConversation } from "@/features/agents/api/client";
import { listChannelSessions } from "../api/channel-sessions";
import { deletePartialPlanSessions } from "./delete-partial-plan";

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
      {
        id: "live",
        title: "Live",
        model: "composer-2.5",
        createdAt: "2026-08-02T00:00:00.000Z",
        updatedAt: "2026-08-02T00:00:00.000Z",
        archived: false,
        activeRun: false,
      },
      {
        id: "archived",
        title: "Old",
        model: "composer-2.5",
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z",
        archived: true,
        activeRun: false,
      },
    ]);
    deleteSession.mockResolvedValue(undefined);

    await deletePartialPlanSessions("stalled-idea");

    expect(listSessions).toHaveBeenCalledWith("stalled-idea", "planning");
    expect(deleteSession).toHaveBeenCalledTimes(2);
    expect(deleteSession.mock.calls[0]?.[0]).toBe("live");
    expect(deleteSession.mock.calls[1]?.[0]).toBe("archived");
  });

  it("stops after the first delete failure", async () => {
    listSessions.mockResolvedValue([
      {
        id: "first",
        title: "First",
        model: "composer-2.5",
        createdAt: "2026-08-02T00:00:00.000Z",
        updatedAt: "2026-08-02T00:00:00.000Z",
        archived: false,
        activeRun: false,
      },
      {
        id: "second",
        title: "Second",
        model: "composer-2.5",
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z",
        archived: true,
        activeRun: false,
      },
    ]);
    deleteSession.mockRejectedValueOnce(new Error("delete failed"));

    await expect(deletePartialPlanSessions("stalled-idea")).rejects.toThrow(
      "delete failed",
    );
    expect(deleteSession).toHaveBeenCalledTimes(1);
    expect(deleteSession).toHaveBeenCalledWith("first");
  });
});
