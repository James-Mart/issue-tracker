import { describe, expect, it } from "vitest";
import { versionOf } from "./issues.js";

describe("versionOf", () => {
  it("is stable for identical content", () => {
    expect(versionOf('{"a":1}', "hello")).toBe(versionOf('{"a":1}', "hello"));
  });

  it("changes when issue.json changes", () => {
    expect(versionOf('{"a":1}', "hello")).not.toBe(
      versionOf('{"a":2}', "hello"),
    );
  });

  it("changes when the description changes", () => {
    expect(versionOf('{"a":1}', "hello")).not.toBe(
      versionOf('{"a":1}', "world"),
    );
  });

  it("keeps the json/description boundary distinct", () => {
    expect(versionOf("ab", "c")).not.toBe(versionOf("a", "bc"));
  });
});
