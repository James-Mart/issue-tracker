// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DiffSearchMatch } from "./review-diff-search";
import {
  clearReviewSearchMarks,
  markReviewContentHits,
  revealMarkInCodeColumn,
  wrapTextOccurrences,
} from "./review-diff-search-mark";

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

function marks(root: ParentNode, attr: "current" | "match"): string[] {
  return [...root.querySelectorAll(`[data-review-search-${attr}]`)].map(
    (mark) => mark.textContent ?? "",
  );
}

function diffSection(lines: string): { section: HTMLElement; shadow: ShadowRoot } {
  const section = document.createElement("section");
  const host = document.createElement("diffs-container");
  const shadow = host.shadowRoot;
  if (!shadow) throw new Error("diffs-container has no shadow root");
  shadow.innerHTML = `<code data-unified><div data-content>${lines}</div></code>`;
  section.append(host);
  return { section, shadow };
}

describe("wrapTextOccurrences", () => {
  it("wraps a hit that spans syntax tokens", () => {
    const line = document.createElement("div");
    const token = document.createElement("span");
    token.append(document.createTextNode("nee"));
    line.append(
      document.createTextNode("new "),
      token,
      document.createTextNode("dle needle"),
    );

    const current = wrapTextOccurrences(line, "needle", 0);

    const currentPieces = [...line.querySelectorAll("[data-review-search-current]")];
    expect(currentPieces.map((mark) => mark.textContent).join("")).toBe("needle");
    expect(current).toBe(currentPieces[0]);
    expect(marks(line, "match")).toEqual(["needle"]);
    expect(line.textContent).toBe("new needle needle");
  });

  it("dims every hit when none is current, including several in one text node", () => {
    const line = document.createElement("div");
    line.append(document.createTextNode("Needle, needle, NEEDLE"));

    expect(wrapTextOccurrences(line, "needle", undefined)).toBeNull();

    expect(marks(line, "match")).toEqual(["Needle", "needle", "NEEDLE"]);
    expect(marks(line, "current")).toEqual([]);
    expect(line.textContent).toBe("Needle, needle, NEEDLE");
  });
});

describe("markReviewContentHits", () => {
  const LINES = `
    <div data-line="2" data-line-type="change-deletion">old needle</div>
    <div data-line="2" data-line-type="change-addition">new needle needle</div>
    <div data-line="3" data-line-type="context">quiet</div>
  `;

  it("marks the current hit and dims the other painted hits", () => {
    const { section, shadow } = diffSection(LINES);

    const mark = markReviewContentHits(section, "needle", contentMatch());

    expect(mark?.textContent).toBe("needle");
    const addition = shadow.querySelector('[data-line-type="change-addition"]')!;
    const deletion = shadow.querySelector('[data-line-type="change-deletion"]')!;
    expect(marks(addition, "match")).toEqual(["needle"]);
    expect(addition.firstElementChild?.hasAttribute("data-review-search-match")).toBe(true);
    expect(addition.lastElementChild).toBe(mark);
    expect(marks(deletion, "match")).toEqual(["needle"]);
    expect(marks(deletion, "current")).toEqual([]);
    expect(addition.textContent).toBe("new needle needle");
  });

  it("leaves lines it already marked alone, so repeated paints do not nest marks", () => {
    const { section, shadow } = diffSection(LINES);
    markReviewContentHits(section, "needle", undefined);

    markReviewContentHits(section, "needle", contentMatch());

    expect(marks(shadow, "match")).toHaveLength(3);
    expect(shadow.querySelector("[data-review-search-match] [data-review-search-match]")).toBeNull();
  });

  it("clears every mark it wrapped and restores the line text", () => {
    const { section, shadow } = diffSection(LINES);
    markReviewContentHits(section, "needle", contentMatch());

    clearReviewSearchMarks(section);

    expect(marks(shadow, "match")).toEqual([]);
    expect(marks(shadow, "current")).toEqual([]);
    expect(shadow.querySelector('[data-line-type="change-addition"]')?.textContent).toBe(
      "new needle needle",
    );
  });
});

describe("revealMarkInCodeColumn", () => {
  function codeColumn(): { column: HTMLElement; mark: HTMLElement } {
    const column = document.createElement("div");
    column.setAttribute("data-code", "");
    column.innerHTML =
      '<div data-gutter></div><div data-content><div data-line="1"><span id="hit">needle</span></div></div>';
    document.body.append(column);
    Object.defineProperty(column, "scrollWidth", { value: 2000 });
    Object.defineProperty(column, "clientWidth", { value: 300 });
    return { column, mark: column.querySelector<HTMLElement>("#hit")! };
  }

  function boxes(markLeft: number) {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement,
    ) {
      if (this.hasAttribute("data-code")) return { left: 0, right: 300 } as DOMRect;
      if (this.hasAttribute("data-gutter")) return { width: 40 } as DOMRect;
      return { left: markLeft, right: markLeft + 60 } as DOMRect;
    });
  }

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("scrolls the code column sideways to a hit past its right edge", () => {
    const { column, mark } = codeColumn();
    boxes(900);

    revealMarkInCodeColumn(mark);

    // Visible code runs 40–300 past the gutter; the hit's center (930) moves to 170.
    expect(column.scrollLeft).toBe(760);
  });

  it("leaves a hit that is already in view", () => {
    const { column, mark } = codeColumn();
    boxes(100);

    revealMarkInCodeColumn(mark);

    expect(column.scrollLeft).toBe(0);
  });
});
