import { describe, expect, it } from "vitest";
import { parseArgs } from "./mockup-resolve.js";

describe("parseArgs", () => {
  it("parses a single id argument", () => {
    expect(parseArgs(["agent-45876f25-f1a3-4300-b066-7da0ac7979d5"])).toEqual({
      conversationId: "agent-45876f25-f1a3-4300-b066-7da0ac7979d5",
    });
  });

  it("requires an id", () => {
    expect(() => parseArgs([])).toThrow(/conversation id or agent id is required/);
  });

  it("rejects extra arguments", () => {
    expect(() => parseArgs(["my-chat", "extra"])).toThrow(
      /Unexpected argument: extra/,
    );
  });
});
