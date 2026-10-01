// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { diffScrollAnchorDrift, pickDiffScrollAnchor } from "./review-diff-scroll-anchor";
import { diffRows, file, place, row, scroller, thread } from "./review-diff-scroll-anchor.test-helpers";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("pickDiffScrollAnchor", () => {
  it("anchors on the first line reaching the top in the first file that does", () => {
    const root = scroller(100);
    file(root, "above.ts", -400, 300);
    const section = file(root, "reading.ts", 0, 1000);
    const shadow = diffRows(section, [
      ["0,0", 70],
      ["1,1", 90],
      ["2,2", 110],
    ]);
    root.scrollTop = 0;

    const anchor = pickDiffScrollAnchor(root)!;

    expect(anchor.offset).toBe(-10);
    expect(anchor.locate(root)).toBe(shadow.children[1]);
  });

  it("anchors on a thread card the top cuts through rather than the line below it", () => {
    const root = scroller(100);
    const section = file(root, "reading.ts", 0, 1000);
    diffRows(section, [["0,0", 300]]);
    const card = thread(section, "t1", 40, 200);

    const anchor = pickDiffScrollAnchor(root)!;

    expect(anchor.locate(root)).toBe(card);
    expect(anchor.offset).toBe(-60);
  });

  it("skips nodes that are not painted", () => {
    const root = scroller(100);
    const section = file(root, "reading.ts", 0, 1000);
    const shadow = diffRows(section, [["4,4", 160]]);
    thread(section, "unslotted", 0, 0);

    expect(pickDiffScrollAnchor(root)!.locate(root)).toBe(shadow.firstElementChild);
  });

  it("anchors on the file itself when it shows nothing to read", () => {
    const root = scroller(100);
    const section = file(root, "collapsed.ts", 120, 36);

    const anchor = pickDiffScrollAnchor(root)!;

    expect(anchor.locate(root)).toBe(section);
    expect(anchor.offset).toBe(20);
  });
});

describe("diffScrollAnchorDrift", () => {
  it("measures how far content above pushed the anchor", () => {
    const root = scroller(100);
    const section = file(root, "reading.ts", 0, 1000);
    const card = thread(section, "t1", 150, 80);
    const anchor = pickDiffScrollAnchor(root)!;

    place(card, 256, 80);

    expect(diffScrollAnchorDrift(root, anchor)).toBe(106);
  });

  it("finds a line Pierre re-rendered by its index", () => {
    const root = scroller(100);
    const section = file(root, "reading.ts", 0, 1000);
    const shadow = diffRows(section, [["7,7", 140]]);
    const anchor = pickDiffScrollAnchor(root)!;

    shadow.replaceChildren(row("7,7", 180));

    expect(diffScrollAnchorDrift(root, anchor)).toBe(40);
  });

  it("is zero once the anchor is gone", () => {
    const root = scroller(100);
    const section = file(root, "reading.ts", 0, 1000);
    const card = thread(section, "t1", 150, 80);
    const anchor = pickDiffScrollAnchor(root)!;

    card.remove();

    expect(diffScrollAnchorDrift(root, anchor)).toBe(0);
  });
});
