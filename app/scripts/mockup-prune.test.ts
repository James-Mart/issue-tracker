import { describe, expect, it } from "vitest";
import { parseArgs } from "./mockup-prune.js";

describe("parseArgs", () => {
  it("parses conversation and keep flags", () => {
    expect(
      parseArgs(["--conversation", "my-chat", "--keep", "direction-a"]),
    ).toEqual({
      conversationId: "my-chat",
      keepDirectionId: "direction-a",
    });
  });

  it("requires conversation and keep", () => {
    expect(() => parseArgs(["--keep", "direction-a"])).toThrow(
      /--conversation is required/,
    );
    expect(() => parseArgs(["--conversation", "my-chat"])).toThrow(
      /--keep is required/,
    );
  });

  it("rejects an unknown option", () => {
    expect(() =>
      parseArgs(["--conversation", "my-chat", "--keep", "a", "--force"]),
    ).toThrow(/Unknown option: --force/);
  });
});
