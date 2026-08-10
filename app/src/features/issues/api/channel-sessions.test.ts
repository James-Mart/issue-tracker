import { describe, expect, it } from "vitest";
import type { ChannelSessionListItem } from "@server/schemas";
import { currentChannelSession } from "./channel-sessions";

function session(
  overrides: Partial<ChannelSessionListItem> & Pick<ChannelSessionListItem, "id">,
): ChannelSessionListItem {
  return {
    title: "Session",
    model: "composer-2.5-fast",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    archived: false,
    activeRun: false,
    ...overrides,
  };
}

describe("currentChannelSession", () => {
  it("returns the first non-archived session (list is updatedAt desc)", () => {
    const sessions = [
      session({ id: "newer-archived", archived: true, updatedAt: "2026-08-03T00:00:00.000Z" }),
      session({ id: "current", updatedAt: "2026-08-02T00:00:00.000Z" }),
      session({ id: "older", updatedAt: "2026-08-01T00:00:00.000Z" }),
    ];
    expect(currentChannelSession(sessions)?.id).toBe("current");
  });

  it("returns undefined when every session is archived", () => {
    expect(
      currentChannelSession([
        session({ id: "a", archived: true }),
        session({ id: "b", archived: true }),
      ]),
    ).toBeUndefined();
  });

  it("returns undefined for an empty list", () => {
    expect(currentChannelSession([])).toBeUndefined();
  });
});
