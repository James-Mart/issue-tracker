import { describe, expect, it } from "vitest";
import { shouldRespawn } from "./restart-contract.js";

describe("shouldRespawn", () => {
  it("is true for the sentinel exit", () => {
    expect(shouldRespawn({ code: 75, signal: null })).toBe(true);
  });

  it("is false for a normal exit", () => {
    expect(shouldRespawn({ code: 0, signal: null })).toBe(false);
  });

  it("is false for a non-sentinel failure", () => {
    expect(shouldRespawn({ code: 1, signal: null })).toBe(false);
  });

  it("is false when terminated by signal", () => {
    expect(shouldRespawn({ code: null, signal: "SIGTERM" })).toBe(false);
  });
});
