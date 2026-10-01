// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import {
  bandRevealDelta,
  nextDiffLineScrollTop,
  paintedDiffLineSpan,
  paintedLineForSide,
} from "./review-diff-line-scroll";

function row(attrs: Record<string, string>, height = 20): HTMLElement {
  const el = document.createElement("div");
  for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
  el.getBoundingClientRect = () =>
    ({
      height,
      width: 0,
      top: 0,
      left: 0,
      bottom: height,
      right: 0,
      x: 0,
      y: 0,
      toJSON() {
        return {};
      },
    }) as DOMRect;
  return el;
}

describe("paintedLineForSide", () => {
  it("reads the new-file number from a unified addition row", () => {
    const host = document.createElement("div");
    host.setAttribute("data-unified", "");
    const line = row({ "data-line": "412", "data-line-type": "change-addition" });
    host.append(line);
    expect(paintedLineForSide(line, "new")).toBe(412);
    expect(paintedLineForSide(line, "old")).toBeNull();
  });

  it("reads the old-file number from a unified deletion row", () => {
    const host = document.createElement("div");
    host.setAttribute("data-unified", "");
    const line = row({ "data-line": "40", "data-line-type": "change-deletion" });
    host.append(line);
    expect(paintedLineForSide(line, "old")).toBe(40);
    expect(paintedLineForSide(line, "new")).toBeNull();
  });

  it("reads the other side from a context row's alt line", () => {
    const host = document.createElement("div");
    host.setAttribute("data-unified", "");
    const line = row({
      "data-line": "80",
      "data-alt-line": "70",
      "data-line-type": "context",
    });
    host.append(line);
    expect(paintedLineForSide(line, "new")).toBe(80);
    expect(paintedLineForSide(line, "old")).toBe(70);
  });
});

describe("paintedDiffLineSpan", () => {
  it("spans only the painted lines for that side", () => {
    const root = document.createElement("div");
    const code = document.createElement("div");
    code.setAttribute("data-unified", "");
    code.append(
      row({ "data-line": "10", "data-line-type": "change-addition" }),
      row({ "data-line": "3", "data-line-type": "change-deletion" }),
      row({ "data-line": "40", "data-line-type": "change-addition" }),
    );
    root.append(code);
    expect(paintedDiffLineSpan(root, "new")).toEqual({ min: 10, max: 40, height: 20 });
    expect(paintedDiffLineSpan(root, "old")).toEqual({ min: 3, max: 3, height: 20 });
  });

  it("returns null until a row has a box", () => {
    const root = document.createElement("div");
    const code = document.createElement("div");
    code.setAttribute("data-unified", "");
    code.append(row({ "data-line": "1", "data-line-type": "change-addition" }, 0));
    root.append(code);
    expect(paintedDiffLineSpan(root, "new")).toBeNull();
  });
});

describe("nextDiffLineScrollTop", () => {
  const span = { min: 1, max: 100, height: 20 };

  it("moves down by the gap after the painted window", () => {
    expect(nextDiffLineScrollTop(3112, span, 412)).toBe(3112 + 312 * 20);
  });

  it("moves up by the gap before the painted window", () => {
    expect(nextDiffLineScrollTop(8000, { min: 300, max: 400, height: 20 }, 40)).toBe(
      8000 - 260 * 20,
    );
  });

  it("stays put when the line is already inside the painted window", () => {
    expect(nextDiffLineScrollTop(100, span, 40)).toBeNull();
  });
});

describe("bandRevealDelta", () => {
  const band = { start: 100, end: 500 };

  it("leaves a hit that is wholly inside the band", () => {
    expect(bandRevealDelta(band, 100, 120)).toBe(0);
    expect(bandRevealDelta(band, 480, 500)).toBe(0);
  });

  it("centers a hit that sits under the pinned header", () => {
    expect(bandRevealDelta(band, 90, 110)).toBe(-200);
  });

  it("centers a hit below the band", () => {
    expect(bandRevealDelta(band, 900, 920)).toBe(610);
  });
});
