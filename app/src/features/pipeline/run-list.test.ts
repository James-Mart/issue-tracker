import { describe, expect, it } from "vitest";
import {
  conditionBadgeLabel,
  formatRunStartedAt,
  recoveredMarkerLabel,
} from "./run-list";

describe("formatRunStartedAt", () => {
  const now = new Date("2026-08-28T15:00:00.000Z");

  it("labels today and yesterday, and otherwise the weekday", () => {
    expect(formatRunStartedAt("2026-08-28T09:12:00.000Z", now)).toMatch(
      /^Today, /,
    );
    expect(formatRunStartedAt("2026-08-27T21:41:00.000Z", now)).toMatch(
      /^Yesterday, /,
    );
    expect(formatRunStartedAt("2026-08-26T16:22:00.000Z", now)).toMatch(
      /^[A-Z][a-z]{2}, /,
    );
  });

  it("returns the raw string when the timestamp is not a date", () => {
    expect(formatRunStartedAt("not-a-date", now)).toBe("not-a-date");
  });
});

describe("conditionBadgeLabel", () => {
  it("maps each condition to the list badge copy", () => {
    expect(conditionBadgeLabel("in-flight")).toBe("live");
    expect(conditionBadgeLabel("completed")).toBe("done");
    expect(conditionBadgeLabel("failed")).toBe("failed");
  });
});

describe("recoveredMarkerLabel", () => {
  it("returns the recovered count in ↻ form", () => {
    expect(recoveredMarkerLabel(1)).toBe("↻1");
    expect(recoveredMarkerLabel(2)).toBe("↻2");
  });
});
