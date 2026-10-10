// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  DiffLineAnnotation,
  FileDiffMetadata,
  SelectedLineRange,
} from "@pierre/diffs/react";
import type {
  ReviewCommits,
  ReviewDiff,
  ReviewDiffFile,
  ReviewView,
} from "@server/schemas";
import type { CommentThread } from "@/features/issues/lib/comment-threads";
import { shortSha } from "@/lib/utils/short-sha";
import { storyReviewPath } from "../lib/links";
import { StoryReviewPage } from "./story-review-page";

const PROJECT = "proj";
const STORY = "story-1";
const TIP = "c1d7f88aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

const state = vi.hoisted(() => ({
  reviews: [] as unknown[],
  diff: undefined as unknown,
  byScope: {} as Record<string, unknown>,
  commits: undefined as unknown,
  setMark: vi.fn(),
  postComment: vi.fn(),
  commentThreads: [] as CommentThread[],
}));

vi.mock("@/features/agents/api/queries", () => ({
  useTranscriptionCapabilityQuery: () => ({
    data: { available: true },
    isLoading: false,
    isError: false,
  }),
}));

vi.mock("@pierre/diffs/react", () => ({
  Virtualizer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  useVirtualizer: () => ({
    getRoot: () => document.body,
    getOffsetInScrollContainer: () => 0,
    getScrollTop: () => 0,
    markDOMDirty: () => {},
    scrollTo: () => {},
  }),
  FileDiff: ({
    fileDiff,
    options,
    lineAnnotations = [],
    renderAnnotation,
  }: {
    fileDiff: FileDiffMetadata;
    options?: { onGutterUtilityClick?: (range: SelectedLineRange) => void };
    lineAnnotations?: DiffLineAnnotation<CommentThread[]>[];
    renderAnnotation?: (annotation: DiffLineAnnotation<CommentThread[]>) => ReactNode;
  }) => (
    <div data-testid="file-diff" data-file-name={fileDiff.name}>
      <button
        type="button"
        data-testid="gutter-new-line-1"
        onClick={() => options?.onGutterUtilityClick?.({ start: 1, end: 1, side: "additions" })}
      />
      {lineAnnotations.map((annotation) => (
        <div
          key={`${annotation.side}:${annotation.lineNumber}`}
          data-testid="line-annotation"
          data-side={annotation.side}
          data-line={annotation.lineNumber}
        >
          {renderAnnotation?.(annotation)}
        </div>
      ))}
    </div>
  ),
}));

vi.mock("@/features/issues/api/mutations", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  usePostComment: () => state.postComment,
  usePostThreadEvent: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("@/features/issues/api/queries", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useIssueDetailQuery: () => ({
    data: { id: STORY, kind: "story", title: "Code review surface" },
    error: null,
    isLoading: false,
  }),
  useCommentsQuery: () => ({
    data: { messages: [], threads: [], problems: [] },
    isLoading: false,
    error: null,
  }),
  useReuseCommentThreads: () => ({
    threads: state.commentThreads,
    problems: [],
    loaded: true,
  }),
  useIssueChangeFileQuery: () => ({ data: "new\n" }),
}));

vi.mock("../api/queries", () => ({
  useReviewsQuery: () => ({ data: { reviews: state.reviews }, error: null }),
  useReviewProgressQuery: () => ({
    data: (state.reviews[0] as ReviewView | undefined)?.progress,
    error: null,
  }),
  useReviewDiffQuery: (_projectId: string, _reviewId: string, scope: string) => ({
    data: state.byScope[scope] ?? state.diff,
    error: null,
  }),
  useReviewCommitsQuery: () => ({ data: state.commits, error: null, isLoading: false }),
}));

vi.mock("../api/mutations", () => ({
  useSetReviewMark: () => ({ mutate: state.setMark, isPending: false }),
  useArchiveReview: () => ({ mutate: vi.fn(), isPending: false }),
  useReopenReview: () => ({ mutate: vi.fn(), isPending: false }),
  useOpenReview: () => ({ mutate: vi.fn(), isPending: false }),
  useSubmitReview: () => ({ mutate: vi.fn(), isPending: false }),
  useRetryOpenReviewSubmissions: () => ({ mutate: vi.fn(), isPending: false }),
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

function reviewFixture(): ReviewView {
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
      commits: {
        [TIP]: { reviewed: 0, total: 3 },
      },
    },
    effectiveStatus: "open",
    submissions: [],
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

const OLDER = "a3f91c2aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function commitFixture(sha: string): ReviewCommits["commits"][number] {
  return {
    sha,
    subject: `change ${shortSha(sha)}`,
    author: "agent",
    authoredAt: "2026-09-29T00:00:00.000Z",
    files: 1,
    additions: 1,
    deletions: 1,
  };
}

let root: Root | undefined;
function mountPage(search?: string): HTMLDivElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const path = storyReviewPath(PROJECT, STORY);
  act(() => {
    root!.render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[search ? `${path}?${search}` : path]}>
          <Routes>
            <Route
              path="/projects/:projectId/review/stories/:storyId"
              element={<StoryReviewPage />}
            />
          </Routes>
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

function setTextarea(textarea: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  if (!setter) throw new Error("no textarea value setter");
  act(() => {
    setter.call(textarea, value);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
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
  state.byScope = {};
  state.commits = commitsFixture();
  state.commentThreads = [];
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

describe("StoryReviewPage", () => {
  it.each([
    ["All changes", "all", TIP],
    ["a commit", OLDER, OLDER],
  ])("anchors a line comment on %s to the viewed commit", (_label, scope, commitSha) => {
    state.commits = commitsFixture({ commits: [commitFixture(OLDER), commitFixture(TIP)] });
    state.byScope[OLDER] = { scope: OLDER, files: [FILES[0]!], patch: PATCH } satisfies ReviewDiff;
    const container = mountPage(`tab=diff&scope=${scope}`);
    const card = fileCard(container, "src/changed.ts");

    click(card.querySelector('[data-testid="gutter-new-line-1"]')!);

    const composer = card.querySelector(
      '[data-testid="line-annotation"][data-line="1"] [data-testid="diff-thread-composer"]',
    );
    expect(composer?.textContent).toContain("line 1");
    setTextarea(composer!.querySelector("textarea")!, "Name this constant.");
    click(composer!.querySelector('button[aria-label="Send"]')!);

    expect(state.postComment).toHaveBeenCalledWith(
      {
        role: "human",
        body: "Name this constant.",
        anchor: { path: "src/changed.ts", side: "new", line: 1, commitSha },
      },
    );
  });

  it("collapses a file when its Reviewed checkbox is checked and records the mark", () => {
    const container = mountPage("tab=diff");
    expect(
      container.querySelector('[data-testid="review-progress"]')?.textContent,
    ).toBe("1 / 3 files reviewed");
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
});
