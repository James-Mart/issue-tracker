import { describe, expect, it } from "vitest";
import {
  attachmentMarkdownInsert,
  attachmentMarkdownLink,
} from "./description-editor-insert";

describe("attachmentMarkdownLink", () => {
  it("uses image markdown when mime.lookup is image/*", () => {
    expect(attachmentMarkdownLink("shot.png")).toBe("![shot.png](shot.png)");
    expect(attachmentMarkdownLink("photo.jpg")).toBe("![photo.jpg](photo.jpg)");
  });

  it("uses a normal link for non-images", () => {
    expect(attachmentMarkdownLink("notes.txt")).toBe("[notes.txt](notes.txt)");
    expect(attachmentMarkdownLink("data.bin")).toBe("[data.bin](data.bin)");
  });
});

describe("attachmentMarkdownInsert", () => {
  it("separates successive batch inserts with a blank line", () => {
    expect(
      attachmentMarkdownInsert("![a.png](a.png)", "b.png", {
        selectionStart: 14,
        afterPriorInsert: true,
      }),
    ).toBe("\n\n![b.png](b.png)");
  });

  it("prefixes a blank line when appending at end onto non-empty text", () => {
    expect(
      attachmentMarkdownInsert("hello", "shot.png", {
        selectionStart: null,
        afterPriorInsert: false,
      }),
    ).toBe("\n\n![shot.png](shot.png)");
  });

  it("does not double-separate when the value already ends with a newline", () => {
    expect(
      attachmentMarkdownInsert("hello\n", "shot.png", {
        selectionStart: null,
        afterPriorInsert: false,
      }),
    ).toBe("![shot.png](shot.png)");
  });
});
