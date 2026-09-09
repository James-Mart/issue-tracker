import { describe, expect, it } from "vitest";
import { transcriptTextForCaret } from "./description-voice-insert";

describe("transcriptTextForCaret", () => {
  it("prepends a leading space when the caret follows non-whitespace", () => {
    expect(transcriptTextForCaret("hello world", 5, "there")).toBe(" there");
  });

  it("does not prepend a space at index 0", () => {
    expect(transcriptTextForCaret("hello", 0, "Hi")).toBe("Hi");
  });

  it("does not prepend a space after whitespace", () => {
    expect(transcriptTextForCaret("hello ", 6, "world")).toBe("world");
    expect(transcriptTextForCaret("hello\n", 6, "world")).toBe("world");
  });
});
