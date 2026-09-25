import { describe, expect, it } from "vitest";
import { parseArgs } from "./mockup-live-links.js";

describe("parseArgs", () => {
  it("requires --conversation", () => {
    expect(() => parseArgs([])).toThrow(/--conversation is required/);
  });

  it("accepts repeated --direction flags", () => {
    expect(
      parseArgs([
        "--conversation",
        "my-chat",
        "--direction",
        "direction-a",
        "--direction",
        "direction-b",
      ]),
    ).toEqual({
      conversationId: "my-chat",
      directionIds: ["direction-a", "direction-b"],
    });
  });

  it("defaults directionIds to empty when omitted", () => {
    expect(parseArgs(["--conversation", "my-chat"])).toEqual({
      conversationId: "my-chat",
      directionIds: [],
    });
  });
});
