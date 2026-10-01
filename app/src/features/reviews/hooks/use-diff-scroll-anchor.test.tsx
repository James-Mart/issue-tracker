// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { file, place, scroller, thread } from "../lib/review-diff-scroll-anchor.test-helpers";
import { useDiffScrollAnchor } from "./use-diff-scroll-anchor";

const virtualizer = vi.hoisted(() => ({
  root: undefined as HTMLElement | undefined,
  getRoot() {
    return this.root;
  },
  getScrollTop() {
    return this.root!.scrollTop;
  },
  markDOMDirty: () => {},
  scrollTo: vi.fn(),
}));

vi.mock("@pierre/diffs/react", () => ({ useVirtualizer: () => virtualizer }));

const resized: ResizeObserverCallback[] = [];
let reactRoot: Root | undefined;
let card: HTMLElement;
let root: HTMLElement;

function Probe() {
  useDiffScrollAnchor();
  return null;
}

function resize() {
  for (const callback of resized) callback([], {} as ResizeObserver);
}

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  resized.length = 0;
  virtualizer.scrollTo.mockReset();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: ResizeObserverCallback) {
        resized.push(callback);
      }
      observe() {}
      disconnect() {}
    },
  );
  root = scroller(0);
  card = thread(file(root, "reading.ts", -2000, 4000), "t1", 250, 80);
  let scrollTop = 17234;
  Object.defineProperty(root, "scrollTop", {
    configurable: true,
    get: () => scrollTop,
    set: (value: number) => {
      scrollTop = value;
    },
  });
  virtualizer.root = root;
  reactRoot = createRoot(document.createElement("div"));
  act(() => reactRoot!.render(<Probe />));
});

afterEach(() => {
  act(() => reactRoot?.unmount());
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("useDiffScrollAnchor", () => {
  it("scrolls by the height that grew above the content being read", () => {
    place(card, 356, 80);
    resize();

    expect(virtualizer.scrollTo).toHaveBeenCalledWith({ top: 17234 + 106 });
  });

  it("leaves a scroll that happened since the anchor was taken alone", () => {
    root.scrollTop = 16000;
    place(card, 1484, 80);
    resize();

    expect(virtualizer.scrollTo).not.toHaveBeenCalled();
  });

  it("holds the content the reader scrolled to", () => {
    root.scrollTop = 17000;
    place(card, 484, 80);
    root.dispatchEvent(new Event("scroll"));

    place(card, 500, 80);
    resize();

    expect(virtualizer.scrollTo).toHaveBeenCalledWith({ top: 17016 });
  });

  it("does nothing when nothing above the reader moved", () => {
    resize();

    expect(virtualizer.scrollTo).not.toHaveBeenCalled();
  });
});
