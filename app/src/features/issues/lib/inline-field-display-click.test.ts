import { describe, expect, it } from "vitest";
import { shouldBeginInlineEdit } from "./inline-field-display-click";

describe("shouldBeginInlineEdit", () => {
  it("enters edit on a plain richDisplay click", () => {
    expect(
      shouldBeginInlineEdit({
        richDisplay: true,
        targetIsLink: false,
        hasTextSelection: false,
      }),
    ).toBe(true);
  });

  it("stays read-only when richDisplay click concludes a text selection", () => {
    expect(
      shouldBeginInlineEdit({
        richDisplay: true,
        targetIsLink: false,
        hasTextSelection: true,
      }),
    ).toBe(false);
  });

  it("stays read-only on a link click", () => {
    expect(
      shouldBeginInlineEdit({
        richDisplay: true,
        targetIsLink: true,
        hasTextSelection: false,
      }),
    ).toBe(false);
  });

  it("enters edit for non-richDisplay even when text is selected", () => {
    expect(
      shouldBeginInlineEdit({
        richDisplay: false,
        targetIsLink: false,
        hasTextSelection: true,
      }),
    ).toBe(true);
  });
});
