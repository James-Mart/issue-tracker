// @vitest-environment happy-dom
import { act, createElement, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { DiffSearchMatch } from "../lib/review-diff-search";
import { useReviewSearchMarks } from "./use-review-search-marks";

const scroller = vi.hoisted(() => ({
  root: undefined as HTMLElement | undefined,
  scrollTo: vi.fn(),
}));

vi.mock("@pierre/diffs/react", () => ({
  useVirtualizer: () => ({
    getRoot: () => scroller.root,
    getOffsetInScrollContainer: () => 0,
    getScrollTop: () => 0,
    scrollTo: (options: { top: number }) => scroller.scrollTo(options),
  }),
}));

const ROOT_BOX = { top: 100, bottom: 500 };
const HEADER_HEIGHT = 40;

function hit(index: number): Extract<DiffSearchMatch, { kind: "content" }> {
  return {
    index,
    path: "src/body.ts",
    kind: "content",
    lineType: "change-addition",
    additionLineNumber: 2,
    deletionLineNumber: 2,
    occurrence: index,
  };
}

function Harness({ match }: { match: DiffSearchMatch | undefined }) {
  const sectionRef = useRef<HTMLElement | null>(null);
  useReviewSearchMarks(sectionRef, match, "needle", false);
  return (
    <section ref={sectionRef} data-testid="review-file">
      <header data-testid="review-file-header" />
      {createElement("diffs-container")}
    </section>
  );
}

let root: Root | undefined;
let container: HTMLDivElement;

function render(match: DiffSearchMatch | undefined) {
  act(() => root!.render(<Harness match={match} />));
}

async function paint(lines: string) {
  const shadow = container.querySelector("diffs-container")!.shadowRoot!;
  await act(async () => {
    shadow.innerHTML = `<code data-unified><div data-content>${lines}</div></code>`;
  });
  return shadow;
}

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  scroller.root = document.createElement("div");
  document.body.appendChild(scroller.root);
  container = document.createElement("div");
  scroller.root.appendChild(container);
  root = createRoot(container);
  scroller.scrollTo.mockReset();
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    if (this === scroller.root) return { ...ROOT_BOX, height: 400 } as DOMRect;
    if (this.dataset.testid === "review-file-header") {
      return { top: ROOT_BOX.top, bottom: ROOT_BOX.top + HEADER_HEIGHT, height: HEADER_HEIGHT } as DOMRect;
    }
    if (this.dataset.testid === "review-file") return { top: 100, bottom: 2000 } as DOMRect;
    if (this.hasAttribute("data-review-search-current")) {
      return { top: 900, bottom: 920, left: 0, right: 0 } as DOMRect;
    }
    if (this.hasAttribute("data-line")) return { top: 0, bottom: 20, height: 20 } as DOMRect;
    return { top: 0, bottom: 0, left: 0, right: 0, height: 0 } as DOMRect;
  });
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("useReviewSearchMarks", () => {
  const LINE = '<div data-line="2" data-line-type="change-addition">needle needle</div>';

  it("lands the current hit in the band below the pinned header by moving only the diff scroller", async () => {
    const pageScroll = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    const intoView = vi.spyOn(HTMLElement.prototype, "scrollIntoView").mockImplementation(() => {});
    render(hit(1));

    const shadow = await paint(LINE);

    expect(shadow.querySelector("[data-review-search-current]")?.textContent).toBe("needle");
    expect(shadow.querySelectorAll("[data-review-search-match]")).toHaveLength(1);
    // Band is 140–500; the hit's center (910) moves to the band's center (320).
    expect(scroller.scrollTo.mock.calls).toEqual([[{ top: 590 }]]);
    expect(pageScroll).not.toHaveBeenCalled();
    expect(intoView).not.toHaveBeenCalled();
  });

  it("re-marks a refreshed hit without moving the reader, and lands again on the next step", async () => {
    render(hit(0));
    await paint(LINE);
    expect(scroller.scrollTo).toHaveBeenCalledOnce();

    render({ ...hit(0) });
    expect(container.querySelector("diffs-container")!.shadowRoot!.querySelector(
      "[data-review-search-current]",
    )).not.toBeNull();
    expect(scroller.scrollTo).toHaveBeenCalledOnce();

    render(hit(1));
    expect(scroller.scrollTo).toHaveBeenCalledTimes(2);
  });

  it("seeks an unpainted deletion hit by old-file numbers while unified rows mix in new ones", async () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback));
    vi.stubGlobal("cancelAnimationFrame", () => {});
    render({
      ...hit(0),
      lineType: "change-deletion",
      deletionLineNumber: 299,
      additionLineNumber: 296,
    });

    await paint(
      '<div data-line="290" data-line-type="change-deletion">needle</div>' +
        '<div data-line="300" data-line-type="change-addition">needle</div>',
    );
    act(() => frames.shift()!(0));

    // Old side painted through 290: 9 rows on, plus the 40-row cushion, at 20px a row.
    expect(scroller.scrollTo.mock.calls[0]).toEqual([{ top: 980 }]);
  });

  it("dims hits in a file that does not hold the current one, and leaves its scroll alone", async () => {
    render(undefined);

    const shadow = await paint(LINE);

    expect(shadow.querySelectorAll("[data-review-search-match]")).toHaveLength(2);
    expect(shadow.querySelector("[data-review-search-current]")).toBeNull();
    expect(scroller.scrollTo).not.toHaveBeenCalled();
  });
});
