// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import type { DiffSearchMatch } from "./review-diff-search";
import { markReviewContentMatch, wrapTextOccurrence } from "./review-diff-search-mark";

function contentMatch(
  overrides: Partial<Extract<DiffSearchMatch, { kind: "content" }>> = {},
): Extract<DiffSearchMatch, { kind: "content" }> {
  return {
    index: 0,
    path: "src/body.ts",
    kind: "content",
    lineType: "change-addition",
    additionLineNumber: 2,
    deletionLineNumber: 2,
    occurrence: 1,
    ...overrides,
  };
}

describe("wrapTextOccurrence", () => {
  it("wraps a hit that spans syntax tokens", () => {
    const line = document.createElement("div");
    const token = document.createElement("span");
    token.append(document.createTextNode("nee"));
    line.append(
      document.createTextNode("new "),
      token,
      document.createTextNode("dle needle"),
    );

    const split = wrapTextOccurrence(line, "needle", 0);
    const splitMarks = [...line.querySelectorAll("[data-review-search-current]")];
    expect(splitMarks.map((mark) => mark.textContent).join("")).toBe("needle");
    expect(split).toBe(splitMarks[0]);
    expect(line.textContent).toBe("new needle needle");
  });
});

describe("markReviewContentMatch", () => {
  it("marks the current line hit and leaves a same-numbered line of another type alone", () => {
    const section = document.createElement("section");
    const host = document.createElement("diffs-container");
    const shadow = host.shadowRoot;
    if (!shadow) throw new Error("diffs-container has no shadow root");
    shadow.innerHTML = `
      <code data-unified>
        <div data-content>
          <div data-line="2" data-line-type="change-deletion">old needle</div>
          <div data-line="2" data-line-type="change-addition">new needle needle</div>
        </div>
      </code>
    `;
    section.append(host);

    const mark = markReviewContentMatch(section, contentMatch(), "needle");

    expect(mark?.textContent).toBe("needle");
    const addition = shadow.querySelector('[data-line-type="change-addition"]');
    expect(addition?.querySelector("[data-review-search-current]")?.textContent).toBe("needle");
    expect(addition?.textContent).toBe("new needle needle");
    expect(
      shadow.querySelector('[data-line-type="change-deletion"] [data-review-search-current]'),
    ).toBeNull();
  });
});
