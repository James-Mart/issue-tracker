import { describe, expect, it } from "vitest";
import {
  currentChannelSession,
  outlinePlanningSessionList,
} from "./channel-sessions";
import { channelSessionListItem as session } from "../test/channel-session-list-item";

describe("currentChannelSession", () => {
  it("returns undefined when every session is archived", () => {
    expect(
      currentChannelSession([
        session({ id: "a", archived: true }),
        session({ id: "b", archived: true }),
      ]),
    ).toBeUndefined();
  });
});

describe("outline session list", () => {
  it("lists both channels and treats an unlabeled planning session as a planner", () => {
    const planner = session({
      id: "planner",
      updatedAt: "2026-08-01T00:00:00.000Z",
    });
    const listed = outlinePlanningSessionList(
      [planner],
      [
        session({
          id: "check",
          outlineRole: "check",
          updatedAt: "2026-08-02T00:00:00.000Z",
        }),
      ],
    );
    expect(listed.map((item) => [item.id, item.outlineRole])).toEqual([
      ["check", "check"],
      ["planner", "planner"],
    ]);
    expect(planner.outlineRole).toBeUndefined();
  });
});
