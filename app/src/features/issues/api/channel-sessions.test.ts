import { describe, expect, it } from "vitest";
import { currentChannelSession } from "./channel-sessions";
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
