// @vitest-environment happy-dom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FileDiffMetadata } from "@pierre/diffs/react";
import { DiffComposerProvider } from "@/features/issues/components/comments/diff-thread-composer";
import type { ReviewFileRow } from "../lib/review-files";
import { ReviewFileDiff } from "./review-file-diff";

const scroller = vi.hoisted(() => ({
  scrollTop: 0,
  fileOffset: 0,
  scrollTo: vi.fn(),
}));

vi.mock("@pierre/diffs/react", () => ({
  useVirtualizer: () => ({
    getScrollTop: () => scroller.scrollTop,
    getOffsetInScrollContainer: () => scroller.fileOffset,
    markDOMDirty: () => {},
    scrollTo: scroller.scrollTo,
  }),
  FileDiff: () => <div data-testid="file-diff" />,
}));

vi.mock("@/features/agents/api/queries", () => ({
  useTranscriptionCapabilityQuery: () => ({
    data: { available: true },
    isLoading: false,
    isError: false,
  }),
}));

vi.mock("@/features/issues/api/mutations", () => ({
  usePostComment: () => ({ mutate: vi.fn(), isPending: false }),
}));

const ROW: ReviewFileRow = {
  file: {
    path: "src/long.ts",
    status: "modified",
    additions: 400,
    deletions: 12,
    blobSha: "long-1",
    tooLarge: false,
  },
  reviewed: false,
  changedSinceReviewed: true,
};

function Harness() {
  const [reviewed, setReviewed] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  return (
    <ReviewFileDiff
      row={{ ...ROW, reviewed }}
      fileDiff={{ name: ROW.file.path } as FileDiffMetadata}
      collapsed={collapsed}
      readOnly={false}
      diffLayout="unified"
      source={{ storyId: "story-1", sha: "tip", contentsCache: new Map() }}
      localCommand="git diff"
      localHint="Read it locally."
      onToggleCollapsed={() => setCollapsed((prev) => !prev)}
      onReviewedChange={(next) => {
        setReviewed(next);
        setCollapsed(next);
      }}
    />
  );
}

let root: Root | undefined;

function mount(): HTMLDivElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <DiffComposerProvider issueId="story-1" commitSha="tip">
        <Harness />
      </DiffComposerProvider>,
    );
  });
  return container;
}

function click(element: Element | null) {
  if (!element) throw new Error("no element to click");
  act(() => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  scroller.scrollTop = 0;
  scroller.fileOffset = 0;
  scroller.scrollTo.mockReset();
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

describe("ReviewFileDiff pinned header", () => {
  it("pins the full header inside a section that does not clip sticky children", () => {
    const container = mount();
    const section = container.querySelector<HTMLElement>('[data-testid="review-file"]')!;
    const header = container.querySelector<HTMLElement>('[data-testid="review-file-header"]')!;

    expect(header.className).toMatch(/\bsticky\b/);
    expect(header.className).toMatch(/\btop-0\b/);
    expect(section.className).not.toMatch(/\boverflow-hidden\b/);
    expect(header.querySelector('[data-testid="review-file-toggle"]')).not.toBeNull();
    expect(header.querySelector('[data-testid="review-file-reviewed"]')).not.toBeNull();
    expect(header.textContent).toContain("src/long.ts");
  });

  it("uses a compact single-row phone header with a dot and no line counts", () => {
    const container = mount();
    const header = container.querySelector<HTMLElement>('[data-testid="review-file-header"]')!;

    expect(header.className).toMatch(/\bflex-nowrap\b/);
    expect(header.querySelector('[data-testid="review-changed-since-dot"]')).not.toBeNull();
    expect(header.querySelector('[data-testid="review-changed-since-badge"]')?.className).toMatch(
      /\bhidden\b/,
    );
    expect(header.querySelector('[data-testid="review-file-line-counts"]')?.className).toMatch(
      /\bhidden\b/,
    );
    const path = header.querySelector("span.min-w-0")!;
    expect(path.className).toMatch(/\[direction:rtl\]/);
  });

  it("returns to the file when it is collapsed from the pinned header", () => {
    const container = mount();
    scroller.fileOffset = 120;
    scroller.scrollTop = 900;

    click(container.querySelector('[data-testid="review-file-toggle"]'));

    expect(container.querySelector('[data-testid="review-file"]')!.getAttribute("data-collapsed")).toBe("true");
    expect(scroller.scrollTo).toHaveBeenCalledOnce();
    expect(scroller.scrollTo).toHaveBeenCalledWith({ top: 120 });
  });

  it("returns to the file when Reviewed is checked from the pinned header", () => {
    const container = mount();
    scroller.fileOffset = 120;
    scroller.scrollTop = 900;

    click(container.querySelector('[data-testid="review-file-reviewed"]'));

    expect(container.querySelector('[data-testid="review-file"]')!.getAttribute("data-collapsed")).toBe("true");
    expect(scroller.scrollTo).toHaveBeenCalledWith({ top: 120 });
  });

  it("leaves the scroll position alone when the file's top is in view", () => {
    const container = mount();
    scroller.fileOffset = 120;
    scroller.scrollTop = 40;

    click(container.querySelector('[data-testid="review-file-toggle"]'));

    expect(container.querySelector('[data-testid="review-file"]')!.getAttribute("data-collapsed")).toBe("true");
    expect(scroller.scrollTo).not.toHaveBeenCalled();
  });

  it("leaves the scroll position alone when a pinned file is expanded again", () => {
    const container = mount();
    click(container.querySelector('[data-testid="review-file-toggle"]'));
    scroller.fileOffset = 120;
    scroller.scrollTop = 900;

    click(container.querySelector('[data-testid="review-file-toggle"]'));

    expect(container.querySelector('[data-testid="review-file"]')!.getAttribute("data-collapsed")).toBe("false");
    expect(scroller.scrollTo).not.toHaveBeenCalled();
  });
});
