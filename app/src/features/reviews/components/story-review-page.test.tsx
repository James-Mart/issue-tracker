// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FileDiffMetadata } from "@pierre/diffs/react";
import type {
  ReviewCommits,
  ReviewDiff,
  ReviewDiffFile,
  ReviewView,
} from "@server/schemas";
import { storyReviewPath } from "../lib/links";
import { StoryReviewPage } from "./story-review-page";

const PROJECT = "proj";
const STORY = "story-1";
const TIP = "c1d7f88aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

const state = vi.hoisted(() => ({
  reviews: [] as unknown[],
  diff: undefined as unknown,
  commits: undefined as unknown,
  setMark: vi.fn(),
  archive: vi.fn(),
  reopen: vi.fn(),
  open: vi.fn(),
}));

vi.mock("@pierre/diffs/react", () => ({
  Virtualizer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  useVirtualizer: () => ({
    getRoot: () => document.body,
    getOffsetInScrollContainer: () => 0,
    scrollTo: () => {},
  }),
  FileDiff: ({ fileDiff }: { fileDiff: FileDiffMetadata }) => (
    <div data-testid="file-diff" data-file-name={fileDiff.name} />
  ),
}));

vi.mock("@/features/issues/api/queries", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useIssueDetailQuery: () => ({
    data: { id: STORY, kind: "story", title: "Code review surface" },
    error: null,
    isLoading: false,
  }),
}));

vi.mock("../api/queries", () => ({
  useReviewsQuery: () => ({ data: { reviews: state.reviews }, error: null }),
  useReviewDiffQuery: () => ({ data: state.diff, error: null }),
  useReviewCommitsQuery: () => ({
    data: state.commits,
    error: null,
    isLoading: false,
  }),
}));

vi.mock("../api/mutations", () => ({
  useSetReviewMark: () => ({ mutate: state.setMark, isPending: false }),
  useArchiveReview: () => ({ mutate: state.archive, isPending: false }),
  useReopenReview: () => ({ mutate: state.reopen, isPending: false }),
  useOpenReview: () => ({ mutate: state.open, isPending: false }),
}));

const FILES: ReviewDiffFile[] = [
  {
    path: "src/changed.ts",
    status: "modified",
    additions: 1,
    deletions: 1,
    blobSha: "changed-2",
    tooLarge: false,
  },
  {
    path: "src/done.ts",
    status: "added",
    additions: 2,
    deletions: 0,
    blobSha: "done-1",
    tooLarge: false,
  },
  {
    path: "src/big.ts",
    status: "added",
    additions: 9000,
    deletions: 0,
    blobSha: "big-1",
    tooLarge: true,
  },
];

const PATCH = [
  "diff --git a/src/changed.ts b/src/changed.ts",
  "index 1111111..2222222 100644",
  "--- a/src/changed.ts",
  "+++ b/src/changed.ts",
  "@@ -1 +1 @@",
  "-old",
  "+new",
  "diff --git a/src/done.ts b/src/done.ts",
  "new file mode 100644",
  "index 0000000..3333333",
  "--- /dev/null",
  "+++ b/src/done.ts",
  "@@ -0,0 +1,2 @@",
  "+one",
  "+two",
  "",
].join("\n");

function reviewFixture(overrides: Partial<ReviewView> = {}): ReviewView {
  return {
    id: "rev-1",
    projectId: PROJECT,
    target: { kind: "story", storyId: STORY },
    status: "open",
    postMortem: false,
    createdAt: "2026-09-29T00:00:00.000Z",
    updatedAt: "2026-09-29T00:00:00.000Z",
    marks: {
      all: {
        "src/changed.ts": { blobSha: "changed-1", markedAt: "2026-09-29T00:00:00.000Z" },
        "src/done.ts": { blobSha: "done-1", markedAt: "2026-09-29T00:00:00.000Z" },
      },
      commits: {},
    },
    progress: {
      all: { reviewed: 1, total: 3, changedSinceReviewed: ["src/changed.ts"] },
      commits: {},
    },
    effectiveStatus: "open",
    ...overrides,
  } as ReviewView;
}

function commitsFixture(overrides: Partial<ReviewCommits> = {}): ReviewCommits {
  return {
    mergeBase: "main",
    mergeBaseRef: "main",
    tip: TIP,
    commits: [
      {
        sha: TIP,
        subject: "add review",
        author: "agent",
        authoredAt: "2026-09-29T00:00:00.000Z",
        files: 3,
        additions: 9003,
        deletions: 1,
      },
    ],
    ...overrides,
  };
}

let root: Root | undefined;
let lastLocation = "";

function LocationProbe() {
  const location = useLocation();
  lastLocation = `${location.pathname}${location.search}`;
  return null;
}

function mountPage(): HTMLDivElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  act(() => {
    root!.render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[storyReviewPath(PROJECT, STORY)]}>
          <Routes>
            <Route
              path="/projects/:projectId/review/stories/:storyId"
              element={<StoryReviewPage />}
            />
          </Routes>
          <LocationProbe />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  return container;
}

function fileCard(container: HTMLElement, path: string): HTMLElement {
  const card = container.querySelector<HTMLElement>(
    `[data-testid="review-file"][data-file-name="${path}"]`,
  );
  if (!card) throw new Error(`no file card for ${path}`);
  return card;
}

function reviewedBox(container: HTMLElement, path: string): HTMLButtonElement {
  const box = fileCard(container, path).querySelector<HTMLButtonElement>(
    '[data-testid="review-file-reviewed"]',
  );
  if (!box) throw new Error(`no Reviewed checkbox for ${path}`);
  return box;
}

function click(element: Element) {
  act(() => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

beforeAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  state.reviews = [reviewFixture()];
  state.diff = { scope: "all", files: FILES, patch: PATCH } satisfies ReviewDiff;
  state.commits = commitsFixture();
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

describe("StoryReviewPage", () => {
  it("writes the Diff tab into the URL and renders one Merge base line", () => {
    const container = mountPage();

    expect(lastLocation).toBe(`${storyReviewPath(PROJECT, STORY)}?tab=diff`);
    const tabs = [...container.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent);
    expect(tabs).toEqual(["Diff"]);
    expect(container.querySelectorAll('[data-testid="review-merge-base"]')).toHaveLength(1);
    expect(
      container.querySelector('[data-testid="review-story-link"]')?.getAttribute("href"),
    ).toBe(`/projects/${PROJECT}/issues/${STORY}`);
    expect(container.textContent).toContain("Archive");
    expect(
      container.querySelector('[data-testid="review-progress"]')?.textContent,
    ).toBe("1 / 3 files reviewed");
  });

  it("collapses a file when its Reviewed checkbox is checked and records the mark", () => {
    const container = mountPage();
    expect(fileCard(container, "src/changed.ts").dataset.collapsed).toBe("false");
    expect(
      fileCard(container, "src/changed.ts").querySelector('[data-testid="file-diff"]'),
    ).not.toBeNull();

    click(reviewedBox(container, "src/changed.ts"));

    expect(state.setMark).toHaveBeenCalledWith(
      { reviewId: "rev-1", scope: "all", path: "src/changed.ts", reviewed: true },
      expect.any(Object),
    );
    expect(fileCard(container, "src/changed.ts").dataset.collapsed).toBe("true");
    expect(
      fileCard(container, "src/changed.ts").querySelector('[data-testid="file-diff"]'),
    ).toBeNull();
    expect(reviewedBox(container, "src/changed.ts").getAttribute("aria-checked")).toBe("true");
    expect(
      container.querySelector('[data-testid="review-progress"]')?.textContent,
    ).toBe("2 / 3 files reviewed");
  });

  it("starts reviewed files collapsed and expands them from the header toggle", () => {
    const container = mountPage();
    const done = fileCard(container, "src/done.ts");
    expect(done.dataset.collapsed).toBe("true");
    expect(reviewedBox(container, "src/done.ts").getAttribute("aria-checked")).toBe("true");

    click(done.querySelector('[data-testid="review-file-toggle"]')!);

    expect(fileCard(container, "src/done.ts").dataset.collapsed).toBe("false");
    expect(
      fileCard(container, "src/done.ts").querySelector('[data-testid="file-diff"]'),
    ).not.toBeNull();
  });

  it("badges a file whose whole-review mark went stale, in the tree and the file header", () => {
    const container = mountPage();
    const treeRow = container.querySelector(
      '[data-testid="review-tree-file"][data-path="src/changed.ts"]',
    );
    expect(treeRow?.getAttribute("data-reviewed")).toBe("false");
    expect(treeRow?.querySelector('[data-testid="review-changed-since-badge"]')).not.toBeNull();
    expect(
      fileCard(container, "src/changed.ts").querySelector(
        '[data-testid="review-changed-since-badge"]',
      ),
    ).not.toBeNull();
    expect(reviewedBox(container, "src/changed.ts").getAttribute("aria-checked")).toBe("false");
    expect(
      container.querySelectorAll('[data-testid="review-changed-since-badge"]'),
    ).toHaveLength(2);
  });

  it("makes Reviewed checkboxes read-only on an archived review and offers Reopen", () => {
    state.reviews = [
      reviewFixture({ effectiveStatus: "archived", archivedReason: "explicit" } as Partial<ReviewView>),
    ];
    const container = mountPage();

    const boxes = container.querySelectorAll<HTMLButtonElement>(
      '[data-testid="review-file-reviewed"]',
    );
    expect(boxes).toHaveLength(3);
    for (const box of boxes) expect(box.disabled).toBe(true);
    click(reviewedBox(container, "src/changed.ts"));
    expect(state.setMark).not.toHaveBeenCalled();

    const buttons = [...container.querySelectorAll("button")].map((b) => b.textContent);
    expect(buttons).toContain("Reopen");
    expect(buttons).not.toContain("Archive");
    click([...container.querySelectorAll("button")].find((b) => b.textContent === "Reopen")!);
    expect(state.reopen).toHaveBeenCalledWith("rev-1");
  });

  it("shows the local git command for a file too large to render", () => {
    const container = mountPage();
    const tooLarge = fileCard(container, "src/big.ts").querySelector(
      '[data-testid="review-file-too-large"]',
    );
    expect(tooLarge?.textContent).toContain("git diff main...c1d7f88 -- src/big.ts");
  });

  it("offers Start review instead of creating a review on visit", () => {
    state.reviews = [];
    const container = mountPage();

    expect(state.open).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="review-diff-tab"]')).toBeNull();
    click([...container.querySelectorAll("button")].find((b) => b.textContent === "Start review")!);
    expect(state.open).toHaveBeenCalledWith(STORY);
  });

  it("shows the empty state when the Story has no commits yet", () => {
    state.commits = commitsFixture({ tip: "", commits: [] });
    state.diff = { scope: "all", files: [], patch: "" } satisfies ReviewDiff;
    const container = mountPage();

    expect(container.querySelector('[data-testid="review-empty-diff"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="review-diff-tab"]')).toBeNull();
  });
});
