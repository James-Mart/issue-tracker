import { describe, expect, it } from "vitest";
import { reviewDraftHasText } from "@/features/reviews/lib/review-draft-storage";
import {
  copyCommentAnchor,
  quoteCommentInput,
  quoteComposerLabel,
} from "./quote-comment";

const STORED = "b".repeat(40);
const PATH = "app/src/features/reviews/components/review-composer.tsx";

describe("quoteComposerLabel", () => {
  it("names the file and line for a code anchor", () => {
    expect(
      quoteComposerLabel({
        path: PATH,
        side: "new",
        line: 420,
        commitSha: STORED,
      }),
    ).toBe(`New thread on ${PATH} · line 420`);
  });

  it("names the file when the anchor has no line", () => {
    expect(quoteComposerLabel({ path: PATH, commitSha: STORED })).toBe(
      `New thread on ${PATH}`,
    );
  });

  it("says New comment when the source has no anchor", () => {
    expect(quoteComposerLabel(undefined)).toBe("New comment");
  });
});

describe("reviewDraftHasText", () => {
  it("treats whitespace as empty", () => {
    expect(reviewDraftHasText("")).toBe(false);
    expect(reviewDraftHasText("  \n")).toBe(false);
    expect(reviewDraftHasText("kept")).toBe(true);
  });
});

describe("quoteCommentInput", () => {
  it("copies a line anchor, including an outdated commit and startLine", () => {
    const anchor = copyCommentAnchor({
      path: PATH,
      side: "old",
      line: 90,
      startLine: 88,
      commitSha: STORED,
    });
    expect(quoteCommentInput("Quoted line.", anchor)).toEqual({
      role: "human",
      body: "Quoted line.",
      anchor: {
        path: PATH,
        side: "old",
        line: 90,
        startLine: 88,
        commitSha: STORED,
      },
    });
  });

  it("copies a file anchor without inventing a line", () => {
    expect(
      quoteCommentInput("Whole file.", { path: PATH, commitSha: STORED }),
    ).toEqual({
      role: "human",
      body: "Whole file.",
      anchor: { path: PATH, commitSha: STORED },
    });
  });

  it("omits the anchor when the source has none", () => {
    expect(quoteCommentInput("Just the words.", undefined)).toEqual({
      role: "human",
      body: "Just the words.",
    });
  });
});
