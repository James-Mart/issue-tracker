// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ReviewDiffFile } from "@server/schemas";
import { REVIEW_SHELL_MEDIA_QUERY } from "../hooks/use-wide-review-workbench";
import { ReviewFileTree } from "./review-file-tree";

const PATH = "app/src/features/reviews/components/review-file-tree.tsx";

const FILE: ReviewDiffFile = {
  path: PATH,
  status: "modified",
  additions: 22,
  deletions: 8,
  blobSha: "abc",
  tooLarge: false,
};

let root: Root | undefined;

function mountTree(onSelect: (path: string) => void) {
  window.matchMedia = ((query: string) => ({
    matches: query !== REVIEW_SHELL_MEDIA_QUERY,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
    onchange: null,
  })) as unknown as typeof window.matchMedia;

  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <ReviewFileTree
        rows={[{ file: FILE, reviewed: true, changedSinceReviewed: false }]}
        selectedPath={PATH}
        onSelect={onSelect}
      />,
    );
  });
  return container;
}

function row(container: HTMLElement, path: string): HTMLElement {
  const el = container.querySelector<HTMLElement>(
    `[data-testid="review-tree-file"][data-path="${path}"]`,
  );
  if (!el) throw new Error(`no row ${path}`);
  return el;
}

function pointer(type: string, target: Element, init: PointerEventInit) {
  act(() => {
    target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, ...init }));
  });
}

beforeAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

describe("ReviewFileTree", () => {
  it("does not select the row after a sideways drag on the path", () => {
    const onSelect = vi.fn();
    const container = mountTree(onSelect);
    const fileRow = row(container, PATH);
    const el = fileRow.querySelector('[data-testid="review-path-scroll"]')!;
    pointer("pointerdown", el, { pointerId: 1, pointerType: "touch", clientX: 20, clientY: 8 });
    pointer("pointermove", el, { pointerId: 1, pointerType: "touch", clientX: 48, clientY: 8 });
    act(() => {
      el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onSelect).not.toHaveBeenCalled();

    pointer("pointerdown", el, { pointerId: 2, pointerType: "touch", clientX: 20, clientY: 8 });
    act(() => {
      el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onSelect).toHaveBeenCalledOnce();
    expect(onSelect).toHaveBeenCalledWith(PATH);
  });
});
