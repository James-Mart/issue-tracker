// @vitest-environment happy-dom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DiffComposerProvider } from "@/features/issues/components/comments/diff-thread-composer";
import { fileDiffsFromPatch } from "@/features/issues/lib/issue-change-file-diffs";
import type { CommentThread } from "@/features/issues/lib/comment-threads";
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
  usePostComment: () => vi.fn(),
  usePostThreadEvent: () => ({ mutate: vi.fn(), isPending: false }),
}));

const PATH = "src/long.ts";

const PATCH = [
  `diff --git a/${PATH} b/${PATH}`,
  "index 1111111..2222222 100644",
  `--- a/${PATH}`,
  `+++ b/${PATH}`,
  "@@ -1,3 +1,3 @@",
  " line1",
  "-old",
  "+new",
  " line3",
].join("\n");

const FILE_DIFF = fileDiffsFromPatch(PATCH)[0]!;

const ROW: ReviewFileRow = {
  file: {
    path: PATH,
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
      fileDiff={FILE_DIFF}
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
      <DiffComposerProvider issueId="story-1" commitSha="tip" allowQuestion>
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
    expect(header.textContent).toContain(PATH);
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

const FILE_THREAD: CommentThread = {
  kind: "review",
  state: "open",
  readyToTask: true,
  root: {
    id: "file-root",
    at: "2026-09-28T16:40:00.000Z",
    role: "human",
    body: "Whole file.",
    anchor: { path: PATH, commitSha: "tip" },
  },
  replies: [],
};

const MISSING_LINE: CommentThread = {
  kind: "review",
  state: "open",
  readyToTask: true,
  root: {
    id: "missing-line",
    at: "2026-09-28T16:41:00.000Z",
    role: "human",
    body: "Lost line.",
    anchor: { path: PATH, side: "new", line: 400, commitSha: "tip" },
  },
  replies: [],
};

function mountThreads(): HTMLDivElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <DiffComposerProvider issueId="story-1" commitSha="tip" allowQuestion>
        <ReviewFileDiff
          row={ROW}
          fileDiff={FILE_DIFF}
          collapsed={false}
          readOnly={false}
          diffLayout="unified"
          source={{ storyId: "story-1", sha: "tip", contentsCache: new Map() }}
          localCommand="git diff"
          localHint="Read it locally."
          onToggleCollapsed={() => {}}
          onReviewedChange={() => {}}
          threads={{ file: [FILE_THREAD], inline: [MISSING_LINE], outdated: [] }}
        />
      </DiffComposerProvider>,
    );
  });
  return container;
}

describe("ReviewFileDiff file comments", () => {
  it("opens the shared composer above the diff from the header button", () => {
    const container = mount();
    const button = container.querySelector('[data-testid="review-file-comment"]');
    expect(button?.getAttribute("aria-label")).toBe("Comment on file");
    expect(button?.getAttribute("title")).toBe("Comment on file");
    expect(container.querySelector('[data-testid="review-file-comments"]')).toBeNull();

    click(button);

    const comments = container.querySelector<HTMLElement>('[data-testid="review-file-comments"]')!;
    const diff = container.querySelector('[data-testid="file-diff"]')!;
    const composer = comments.querySelector('[data-testid="diff-thread-composer"]');
    expect(comments.textContent).toContain("File comment");
    expect(composer?.querySelector('button[aria-label="Send"]')).not.toBeNull();
    expect(composer?.querySelector('button[aria-label="Ask a question"]')).not.toBeNull();
    expect(comments.compareDocumentPosition(diff) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
  });

  it("expands a collapsed file so the file composer is visible", () => {
    const container = mount();
    click(container.querySelector('[data-testid="review-file-toggle"]'));
    expect(container.querySelector('[data-testid="review-file"]')!.getAttribute("data-collapsed")).toBe(
      "true",
    );

    click(container.querySelector('[data-testid="review-file-comment"]'));

    expect(container.querySelector('[data-testid="review-file"]')!.getAttribute("data-collapsed")).toBe(
      "false",
    );
    expect(container.querySelector('[data-testid="diff-thread-composer"]')).not.toBeNull();
  });

  it("renders a file thread above the diff and keeps an unlocated line below it", () => {
    const container = mountThreads();
    const comments = container.querySelector<HTMLElement>('[data-testid="review-file-comments"]')!;
    const diff = container.querySelector('[data-testid="file-diff"]')!;
    const fileCard = comments.querySelector('[data-thread-root="file-root"]');
    const end = [...container.querySelectorAll('[data-testid="review-line-threads"]')].find(
      (node) => !comments.contains(node),
    );

    expect(fileCard?.textContent).toContain("Whole file.");
    expect(fileCard?.querySelector('[data-testid="comment-anchor-meta"]')).toBeNull();
    expect(end?.querySelector('[data-thread-root="missing-line"]')?.textContent).toContain(
      "Lost line.",
    );
    expect(comments.compareDocumentPosition(diff) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    expect(diff.compareDocumentPosition(end!) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
  });
});
