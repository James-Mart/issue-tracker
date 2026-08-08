// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import {
  richDisplayInteractiveTarget,
  shouldBeginInlineEdit,
} from "./inline-field-display-click";

describe("shouldBeginInlineEdit", () => {
  it("enters edit on a plain richDisplay click", () => {
    expect(
      shouldBeginInlineEdit({
        richDisplay: true,
        targetIsLink: false,
        targetIsImage: false,
        hasTextSelection: false,
      }),
    ).toBe(true);
  });

  it("stays read-only when richDisplay click concludes a text selection", () => {
    expect(
      shouldBeginInlineEdit({
        richDisplay: true,
        targetIsLink: false,
        targetIsImage: false,
        hasTextSelection: true,
      }),
    ).toBe(false);
  });

  it("stays read-only on a link click", () => {
    expect(
      shouldBeginInlineEdit({
        richDisplay: true,
        targetIsLink: true,
        targetIsImage: false,
        hasTextSelection: false,
      }),
    ).toBe(false);
  });

  it("stays read-only on an image click", () => {
    expect(
      shouldBeginInlineEdit({
        richDisplay: true,
        targetIsLink: false,
        targetIsImage: true,
        hasTextSelection: false,
      }),
    ).toBe(false);
  });

  it("enters edit for non-richDisplay even when text is selected", () => {
    expect(
      shouldBeginInlineEdit({
        richDisplay: false,
        targetIsLink: false,
        targetIsImage: false,
        hasTextSelection: true,
      }),
    ).toBe(true);
  });
});

describe("richDisplayInteractiveTarget", () => {
  it("detects links and markdown image triggers", () => {
    const root = document.createElement("div");
    root.innerHTML =
      '<a href="#">link</a><button data-markdown-image type="button"><img alt=""></button>';
    const link = root.querySelector("a")!;
    const trigger = root.querySelector("[data-markdown-image]")!;
    const img = root.querySelector("img")!;

    expect(richDisplayInteractiveTarget(link)).toEqual({
      targetIsLink: true,
      targetIsImage: false,
    });
    expect(richDisplayInteractiveTarget(trigger)).toEqual({
      targetIsLink: false,
      targetIsImage: true,
    });
    expect(richDisplayInteractiveTarget(img)).toEqual({
      targetIsLink: false,
      targetIsImage: true,
    });
    expect(richDisplayInteractiveTarget(root)).toEqual({
      targetIsLink: false,
      targetIsImage: false,
    });
  });
});
