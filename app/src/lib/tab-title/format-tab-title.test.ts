import { describe, expect, it } from "vitest";
import { formatTabTitle, graphemeCount } from "./format-tab-title";

describe("formatTabTitle", () => {
  it("respects combining marks as single graphemes when truncating", () => {
    const title = formatTabTitle({ name: "e\u0301".repeat(30) });
    expect(graphemeCount(title)).toBeLessThanOrEqual(25);
  });

  it("prefixes static page names", () => {
    expect(formatTabTitle({ name: "Cockpit" })).toBe("IT: Cockpit");
    expect(formatTabTitle({ name: "Agents" })).toBe("IT: Agents");
    expect(formatTabTitle({ name: "Pipelines" })).toBe("IT: Pipelines");
    expect(formatTabTitle({ name: "Runs" })).toBe("IT: Runs");
    expect(formatTabTitle({ name: "Settings" })).toBe("IT: Settings");
  });

  it("keeps suffixes intact and truncates the name with an ellipsis", () => {
    const title = formatTabTitle({
      name: "abcdefghijklmnopqrstuvwxyz",
      suffix: "Overview",
    });
    expect(title.endsWith("\u00B7Overview")).toBe(true);
    expect(title).toContain("\u2026");
    expect(graphemeCount(title)).toBe(25);
  });

  it("does not add an ellipsis when the title already fits", () => {
    expect(
      formatTabTitle({ name: "issue-tracker", suffix: "Diff" }),
    ).toBe("IT: issue-tracker\u00B7Diff");
  });

  it("truncates long names without a suffix", () => {
    const title = formatTabTitle({
      name: "abcdefghijklmnopqrstuvwxyz",
    });
    expect(title.endsWith("\u2026")).toBe(true);
    expect(graphemeCount(title)).toBe(25);
  });

  it("never exceeds 25 graphemes for emoji-heavy names", () => {
    expect(graphemeCount(formatTabTitle({ name: "👍🏽".repeat(20) }))).toBe(24);
    expect(
      graphemeCount(formatTabTitle({ name: "👍🏽".repeat(40) })),
    ).toBeLessThanOrEqual(25);
  });

  it("throws when a suffix alone cannot fit", () => {
    expect(() =>
      formatTabTitle({ name: "", suffix: "x".repeat(30) }),
    ).toThrow(/suffix does not fit/);
  });
});
