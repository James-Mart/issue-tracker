// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ReviewFileListLayout } from "./review-file-list-resize";
import { ReviewFileTree } from "./review-file-tree";
import {
  DEFAULT_REVIEW_FILE_LIST_WIDTH,
  MIN_REVIEW_FILE_LIST_WIDTH,
  REVIEW_FILE_LIST_WIDTH_STEP,
  REVIEW_FILE_LIST_WIDTH_STORAGE_KEY,
} from "../lib/review-file-list-width";
import type { ReviewFileRow } from "../lib/review-files";

const SPLIT_WIDTH = 1000;

const ROW: ReviewFileRow = {
  file: {
    path: "src/auth/session.ts",
    status: "modified",
    additions: 32,
    deletions: 6,
    blobSha: "blob-1",
    tooLarge: false,
  },
  reviewed: false,
  changedSinceReviewed: false,
};

let root: Root | undefined;
let container: HTMLDivElement | undefined;
let originalClientWidth: PropertyDescriptor | undefined;
let originalRect: typeof HTMLElement.prototype.getBoundingClientRect;

function columns(): HTMLElement {
  const el = container!.querySelector<HTMLElement>('[data-testid="review-diff-columns"]');
  if (!el) throw new Error("missing columns");
  return el;
}

function handle(): HTMLElement {
  const el = container!.querySelector<HTMLElement>('[data-testid="review-file-list-resize"]');
  if (!el) throw new Error("missing resize handle");
  return el;
}

function widthPx(): string {
  return columns().style.getPropertyValue("--review-file-list-width");
}

function dispatchPointer(
  target: EventTarget,
  type: "pointerdown" | "pointermove" | "pointerup",
  clientX: number,
) {
  act(() => {
    target.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        button: 0,
        pointerId: 1,
        pointerType: "mouse",
        clientX,
      }),
    );
  });
}

function pressKey(key: string) {
  act(() => {
    handle().dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
    );
  });
}

function mount() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <ReviewFileListLayout
        tree={
          <ReviewFileTree rows={[ROW]} selectedPath={undefined} onSelect={() => {}} />
        }
      >
        <div data-testid="review-diff-stack" />
      </ReviewFileListLayout>,
    );
  });
}

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  localStorage.clear();
  originalClientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
  originalRect = HTMLElement.prototype.getBoundingClientRect;
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get() {
      return (this as HTMLElement).dataset.testid === "review-diff-columns" ? SPLIT_WIDTH : 0;
    },
  });
  HTMLElement.prototype.getBoundingClientRect = function () {
    if (this.dataset.testid === "review-diff-columns") {
      return new DOMRect(0, 0, SPLIT_WIDTH, 600);
    }
    return new DOMRect();
  };
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  container?.remove();
  container = undefined;
  if (originalClientWidth) {
    Object.defineProperty(HTMLElement.prototype, "clientWidth", originalClientWidth);
  }
  HTMLElement.prototype.getBoundingClientRect = originalRect;
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("ReviewFileListLayout", () => {
  it("starts at the default width and keeps the handle off the phone stack", () => {
    mount();

    expect(widthPx()).toBe(`${DEFAULT_REVIEW_FILE_LIST_WIDTH}px`);
    expect(columns().className).toContain("flex-col");
    expect(columns().className).toContain("shell:flex-row");
    expect(handle().className).toContain("hidden");
    expect(handle().className).toContain("shell:flex");
    expect(handle().getAttribute("role")).toBe("separator");
    expect(handle().getAttribute("aria-orientation")).toBe("vertical");
    expect(handle().getAttribute("aria-valuemin")).toBe(String(MIN_REVIEW_FILE_LIST_WIDTH));
    expect(handle().getAttribute("aria-valuemax")).toBe(String(SPLIT_WIDTH / 2));
    expect(handle().getAttribute("aria-valuenow")).toBe(String(DEFAULT_REVIEW_FILE_LIST_WIDTH));

    const tree = container!.querySelector<HTMLElement>('[data-testid="review-file-tree"]')!;
    const list = container!.querySelector<HTMLElement>("#review-file-list")!;
    expect(list.className).toContain("shell:w-[var(--review-file-list-width)]");
    expect(tree.className).not.toContain("--review-file-list-width");
    expect(tree.style.width).toBe("");

    const grip = container!.querySelector<HTMLElement>(
      '[data-testid="review-file-list-resize-grip"]',
    )!;
    expect(grip.className).toContain("h-8");
    expect(grip.className).toContain("group-hover:bg-primary");
    expect(grip.className).toContain("group-focus-visible:bg-primary");
    expect(grip.className).not.toContain(" bg-primary");
    expect(handle().className).toContain("focus-visible:ring-ring");
  });

  it("drags the list, clamps to the floor and half the split, and persists on release", () => {
    mount();
    const grip = handle();

    dispatchPointer(grip, "pointerdown", 256);
    expect(grip.dataset.dragging).toBe("true");
    expect(
      container!.querySelector('[data-testid="review-file-list-resize-grip"]')!.className,
    ).toContain("bg-primary");
    expect(localStorage.getItem(REVIEW_FILE_LIST_WIDTH_STORAGE_KEY)).toBeNull();

    dispatchPointer(grip, "pointermove", 400);
    expect(widthPx()).toBe("400px");
    dispatchPointer(grip, "pointerup", 400);

    expect(grip.dataset.dragging).toBe("false");
    expect(localStorage.getItem(REVIEW_FILE_LIST_WIDTH_STORAGE_KEY)).toBe("400");
    expect(handle().getAttribute("aria-valuenow")).toBe("400");

    dispatchPointer(handle(), "pointerdown", 400);
    dispatchPointer(handle(), "pointermove", 40);
    dispatchPointer(handle(), "pointerup", 40);
    expect(widthPx()).toBe(`${MIN_REVIEW_FILE_LIST_WIDTH}px`);
    expect(localStorage.getItem(REVIEW_FILE_LIST_WIDTH_STORAGE_KEY)).toBe(
      String(MIN_REVIEW_FILE_LIST_WIDTH),
    );

    dispatchPointer(handle(), "pointerdown", 180);
    dispatchPointer(handle(), "pointermove", 900);
    dispatchPointer(handle(), "pointerup", 900);
    expect(widthPx()).toBe("500px");
    expect(localStorage.getItem(REVIEW_FILE_LIST_WIDTH_STORAGE_KEY)).toBe("500");
  });

  it("steps with arrow keys and resets to the default on double-click", () => {
    mount();

    pressKey("ArrowRight");
    expect(widthPx()).toBe(`${DEFAULT_REVIEW_FILE_LIST_WIDTH + REVIEW_FILE_LIST_WIDTH_STEP}px`);
    pressKey("ArrowUp");
    pressKey("ArrowDown");
    expect(widthPx()).toBe(`${DEFAULT_REVIEW_FILE_LIST_WIDTH + REVIEW_FILE_LIST_WIDTH_STEP}px`);
    pressKey("ArrowLeft");
    expect(widthPx()).toBe(`${DEFAULT_REVIEW_FILE_LIST_WIDTH}px`);
    expect(localStorage.getItem(REVIEW_FILE_LIST_WIDTH_STORAGE_KEY)).toBe(
      String(DEFAULT_REVIEW_FILE_LIST_WIDTH),
    );

    pressKey("ArrowLeft");
    expect(widthPx()).toBe(`${DEFAULT_REVIEW_FILE_LIST_WIDTH - REVIEW_FILE_LIST_WIDTH_STEP}px`);

    act(() => {
      handle().dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
    });
    expect(localStorage.getItem(REVIEW_FILE_LIST_WIDTH_STORAGE_KEY)).toBeNull();
    expect(widthPx()).toBe(`${DEFAULT_REVIEW_FILE_LIST_WIDTH}px`);
  });

  it("restores the same width for a later review in this browser", () => {
    mount();
    dispatchPointer(handle(), "pointerdown", 256);
    dispatchPointer(handle(), "pointermove", 360);
    dispatchPointer(handle(), "pointerup", 360);
    expect(widthPx()).toBe("360px");

    act(() => root!.unmount());
    container!.remove();
    root = undefined;
    container = undefined;

    mount();
    expect(widthPx()).toBe("360px");
    expect(localStorage.getItem(REVIEW_FILE_LIST_WIDTH_STORAGE_KEY)).toBe("360");
  });
});
