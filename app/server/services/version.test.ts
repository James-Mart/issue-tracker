import { describe, expect, it } from "vitest";
import { versionOf } from "./issues.js";

describe("versionOf", () => {
  it("keeps the json/description boundary distinct", () => {
    expect(versionOf("ab", "c")).not.toBe(versionOf("a", "bc"));
  });
});
