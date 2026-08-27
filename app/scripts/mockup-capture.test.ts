import { describe, expect, it } from "vitest";
import { parseArgs } from "./mockup-capture.js";

describe("parseArgs", () => {
  it("requires --conversation and defaults viewports to phone and desktop", () => {
    expect(parseArgs(["--conversation", "my-chat"])).toEqual({
      conversationId: "my-chat",
      directionId: undefined,
      viewports: ["phone", "desktop"],
      baseUrl: undefined,
    });
  });

  it("accepts direction, viewports, and base URL overrides", () => {
    expect(
      parseArgs([
        "--conversation",
        "my-chat",
        "--direction",
        "direction-a",
        "--viewports",
        "phone,desktop",
        "--base-url",
        "http://127.0.0.1:4100/",
      ]),
    ).toEqual({
      conversationId: "my-chat",
      directionId: "direction-a",
      viewports: ["phone", "desktop"],
      baseUrl: "http://127.0.0.1:4100",
    });
  });

  it("rejects missing conversation", () => {
    expect(() => parseArgs(["--direction", "direction-a"])).toThrow(
      /--conversation is required/,
    );
  });
});
