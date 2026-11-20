import { describe, expect, it } from "vitest";
import {
  channelSessionSwitcherParts,
  currentChannelSession,
  labelPlanningSessions,
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

describe("planning session labels", () => {
  it("names an unlabeled planning session as a planner and leaves the row unchanged", () => {
    const planner = session({ id: "planner" });
    const labeled = labelPlanningSessions([planner]);
    expect(labeled.map((item) => item.outlineRole)).toEqual(["planner"]);
    expect(planner.outlineRole).toBeUndefined();
    expect(channelSessionSwitcherParts(labeled[0]!).role).toBe("Planner");
  });
});
