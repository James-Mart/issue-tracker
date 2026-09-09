import { describe, expect, it } from "vitest";
import { formatRelativeUpdatedAt } from "./format-relative-updated-at";

describe("formatRelativeUpdatedAt", () => {
  const now = Date.parse("2026-09-09T12:00:00.000Z");

  it("formats hours ago", () => {
    expect(
      formatRelativeUpdatedAt("2026-09-09T10:00:00.000Z", now),
    ).toBe("2h ago");
  });

  it("returns the raw string for invalid dates", () => {
    expect(formatRelativeUpdatedAt("not-a-date", now)).toBe("not-a-date");
  });
});
