import { describe, expect, it } from "vitest";
import { summarizeToolCall } from "./tool-summary";

describe("summarizeToolCall", () => {
  it('uses "tool" when the name is missing or blank', () => {
    expect(summarizeToolCall(undefined, undefined)).toEqual({
      label: "tool",
      detail: null,
    });
    expect(summarizeToolCall(null, undefined)).toEqual({
      label: "tool",
      detail: null,
    });
    expect(summarizeToolCall("   ", undefined)).toEqual({
      label: "tool",
      detail: null,
    });
  });

  it("trims the tool name and picks the first string arg as detail", () => {
    expect(
      summarizeToolCall("  Shell  ", {
        description: "List workspace files",
        block_until_ms: 30000,
      }),
    ).toEqual({
      label: "Shell",
      detail: "List workspace files",
    });
  });

  it("truncates detail to 80 characters", () => {
    const long = "x".repeat(100);
    expect(summarizeToolCall("Read", { path: long }).detail).toHaveLength(80);
  });

  it("returns null detail when args is not an object", () => {
    expect(summarizeToolCall("Grep", "pattern").detail).toBeNull();
    expect(summarizeToolCall("Grep", 42).detail).toBeNull();
  });
});
