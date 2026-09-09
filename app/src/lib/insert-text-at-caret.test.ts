import { describe, expect, it } from "vitest";
import { insertTextAtCaret } from "./insert-text-at-caret";

describe("insertTextAtCaret", () => {
  it("inserts at the caret and advances selection", () => {
    expect(insertTextAtCaret("ab", "X", 1, 1)).toEqual({
      value: "aXb",
      selectionStart: 2,
      selectionEnd: 2,
    });
  });

  it("replaces a selection range", () => {
    expect(insertTextAtCaret("abcd", "X", 1, 3)).toEqual({
      value: "aXd",
      selectionStart: 2,
      selectionEnd: 2,
    });
  });

  it("appends when caret is nullish", () => {
    expect(insertTextAtCaret("hi", "!", null, null)).toEqual({
      value: "hi!",
      selectionStart: 3,
      selectionEnd: 3,
    });
  });
});
