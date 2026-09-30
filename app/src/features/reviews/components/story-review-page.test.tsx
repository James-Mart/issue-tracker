// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
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
import { projectReviewPath, storyReviewPath } from "../lib/links";
import { StoryReviewPage } from "./story-review-page";

const PROJECT = "proj";
const STORY = "story-1";
const TIP = "c1d7f88aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

const state = vi.hoisted(() => ({
  reviews: [] as unknown[],
  diff: undefined as unknown,
  byScope: {} as Record<string, unknown>,
  diffScope: "",
  commits: undefined as unknown,
  setMark: vi.fn(),
  archive: vi.fn(),
  reopen: vi.fn(),
  open: vi.fn(),
  submitReview: vi.fn(),
  retrySubmission: vi.fn(),
  postComment: vi.fn(),
  commentThreads: [] as CommentThread[],
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
  usePostComment: () => ({ mutate: state.postComment, isPending: false }),
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
  useCommentThreads: () => ({
    threads: state.commentThreads,
    problems: [],
    loaded: true,
  }),
  useIssueChangeFileQuery: () => ({ data: "new\n" }),
}));

vi.mock("../api/queries", () => ({
  useReviewsQuery: () => ({ data: { reviews: state.reviews }, error: null }),
  useReviewDiffQuery: (_projectId: string, _reviewId: string, scope: string) => {
    state.diffScope = scope;
    return { data: state.byScope[scope] ?? state.diff, error: null };
  },
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
  useSubmitReview: () => ({ mutate: state.submitReview, isPending: false }),
  useRetryReviewSubmission: () => ({ mutate: state.retrySubmission, isPending: false }),
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
      commits: {
        [TIP]: { reviewed: 0, total: 3 },
      },
    },
    effectiveStatus: "open",
    submissions: [],
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

/** A thread on `src/changed.ts` (new side), or a general thread without `anchor`. */
function anchoredThread(
  id: string,
  body: string,
  anchor?: { line: number; commitSha: string },
  outdated = false,
): CommentThread {
  return {
    kind: "review",
    state: "open",
    readyToTask: true,
    root: {
      id,
      at: "2026-09-28T16:40:00.000Z",
      role: "human",
      name: "Jared",
      body,
      ...(outdated ? { outdated: true } : {}),
      ...(anchor ? { anchor: { path: "src/changed.ts", side: "new" as const, ...anchor } } : {}),
    },
    replies: [],
  };
}

let root: Root | undefined;
let lastLocation = "";

function LocationProbe() {
  const location = useLocation();
  lastLocation = `${location.pathname}${location.search}`;
  return null;
}

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

function tab(container: HTMLElement, name: string): HTMLElement {
  const match = [...container.querySelectorAll<HTMLElement>('[role="tab"]')].find(
    (el) => el.textContent === name,
  );
  if (!match) throw new Error(`no tab ${name}`);
  return match;
}

function scopeRow(container: HTMLElement, scope: string): HTMLElement {
  const row = container.querySelector<HTMLElement>(
    `[data-testid="review-scope-row"][data-scope="${scope}"]`,
  );
  if (!row) throw new Error(`no scope row ${scope}`);
  return row;
}

function selectScope(row: HTMLElement) {
  const input = row.querySelector("input");
  if (!input) throw new Error("no scope radio");
  act(() => {
    input.click();
  });
}

function setInput(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (!setter) throw new Error("no input value setter");
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
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

function treePaths(container: HTMLElement): string[] {
  return [...container.querySelectorAll("[data-testid='review-tree-file']")].map(
    (row) => row.getAttribute("data-path") ?? "",
  );
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
  state.diffScope = "";
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
  it("opens the Conversation tab by default and keeps the scope in the URL", () => {
    const container = mountPage();

    expect(lastLocation).toBe(
      `${storyReviewPath(PROJECT, STORY)}?tab=conversation&scope=all`,
    );
    const tabs = [...container.querySelectorAll('[role="tab"]')].map((el) => el.textContent);
    expect(tabs).toEqual(["Conversation", "Commits", "Diff"]);
    expect(container.querySelectorAll('[data-testid="review-merge-base"]')).toHaveLength(1);
    expect(
      container.querySelector('[data-testid="review-story-link"]')?.getAttribute("href"),
    ).toBe(`/projects/${PROJECT}/issues/${STORY}`);
    expect(
      container.querySelector('[data-testid="review-back-to-home"]')?.getAttribute("href"),
    ).toBe(projectReviewPath(PROJECT));
    expect(container.textContent).toContain("Archive");
    expect(container.querySelector('[data-testid="review-conversation-tab"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="review-commits-tab"]')).toBeNull();
    expect(container.querySelector('[data-testid="review-diff-tab"]')).toBeNull();

    click(tab(container, "Commits"));

    expect(lastLocation).toBe(`${storyReviewPath(PROJECT, STORY)}?tab=commits&scope=all`);
    expect(container.querySelector('[data-testid="review-commits-tab"]')).not.toBeNull();
    expect(scopeRow(container, "all").getAttribute("data-selected")).toBe("true");
    expect(scopeRow(container, "all").children).toHaveLength(1);
  });

  it("opens an anchored thread inline on the Diff tab at its commit", () => {
    state.commentThreads = [
      {
        kind: "review",
        state: "open",
        readyToTask: true,
        root: {
          id: "thread-1",
          at: "2026-09-28T16:40:00.000Z",
          role: "human",
          name: "Jared",
          body: "Check the new line.",
          anchor: {
            path: "src/changed.ts",
            side: "new",
            line: 1,
            commitSha: TIP,
          },
        },
        replies: [],
      },
    ];
    const container = mountPage();
    click(container.querySelector('[data-testid="see-in-diff"]')!);

    expect(lastLocation).toBe(
      `${storyReviewPath(PROJECT, STORY)}?tab=diff&scope=${TIP}&thread=thread-1`,
    );
    const card = fileCard(container, "src/changed.ts");
    expect(card.dataset.collapsed).toBe("false");
    const thread = card.querySelector('[data-thread-root="thread-1"]');
    expect(thread?.textContent).toContain("Check the new line.");
    expect(thread?.querySelector('[data-testid="thread-resolve"]')).not.toBeNull();
  });

  it("opens All changes when the anchor commit no longer contains the file", () => {
    state.byScope[TIP] = {
      scope: TIP,
      files: [
        {
          path: "src/other.ts",
          status: "modified",
          additions: 1,
          deletions: 0,
          blobSha: "other-1",
          tooLarge: false,
        },
      ],
      patch: [
        "diff --git a/src/other.ts b/src/other.ts",
        "index 1111111..2222222 100644",
        "--- a/src/other.ts",
        "+++ b/src/other.ts",
        "@@ -1 +1 @@",
        "-old",
        "+new",
        "",
      ].join("\n"),
    } satisfies ReviewDiff;
    state.commentThreads = [
      {
        kind: "review",
        state: "open",
        readyToTask: true,
        root: {
          id: "drifted",
          at: "2026-09-28T16:40:00.000Z",
          role: "human",
          name: "Jared",
          body: "This line moved.",
          anchor: {
            path: "src/changed.ts",
            side: "new",
            line: 1,
            commitSha: TIP,
          },
        },
        replies: [],
      },
    ];
    const container = mountPage();
    click(container.querySelector('[data-testid="see-in-diff"]')!);

    expect(lastLocation).toBe(
      `${storyReviewPath(PROJECT, STORY)}?tab=diff&scope=all&thread=drifted`,
    );
    const card = fileCard(container, "src/changed.ts");
    expect(card.querySelector('[data-thread-root="drifted"]')?.textContent).toContain(
      "This line moved.",
    );
  });

  it("places every anchored thread on All changes and groups outdated ones in their file", () => {
    state.commentThreads = [
      anchoredThread("general", "A general note."),
      anchoredThread("current", "Check the new line.", { line: 1, commitSha: OLDER }),
      anchoredThread("drifted", "This line moved.", { line: 5, commitSha: OLDER }, true),
    ];
    const container = mountPage("tab=diff");
    const card = fileCard(container, "src/changed.ts");

    const line = card.querySelector('[data-testid="line-annotation"][data-line="1"]');
    expect(line?.querySelector('[data-thread-root="current"]')?.textContent).toContain(
      "Check the new line.",
    );
    const outdated = card.querySelector('[data-testid="review-outdated-threads"]');
    const drifted = outdated?.querySelector('[data-thread-root="drifted"]');
    expect(drifted?.hasAttribute("data-collapsed")).toBe(true);
    expect(drifted?.textContent).toContain("line 5 · 1 comment");
    expect(line?.querySelector('[data-thread-root="drifted"]')).toBeNull();
    expect(container.querySelector('[data-thread-root="general"]')).toBeNull();
    expect(container.textContent).not.toContain("A general note.");
  });

  it("shows only threads anchored to the viewed commit, outdated ones at their line", () => {
    state.commits = commitsFixture({ commits: [commitFixture(OLDER), commitFixture(TIP)] });
    state.byScope[OLDER] = { scope: OLDER, files: [FILES[0]!], patch: PATCH } satisfies ReviewDiff;
    state.commentThreads = [
      anchoredThread("older", "From the older commit.", { line: 1, commitSha: OLDER }),
      anchoredThread("drifted", "Drifted since.", { line: 1, commitSha: OLDER }, true),
      anchoredThread("tip", "From the tip.", { line: 1, commitSha: TIP }),
    ];
    const container = mountPage(`tab=diff&scope=${OLDER}`);
    const line = fileCard(container, "src/changed.ts").querySelector(
      '[data-testid="line-annotation"][data-line="1"]',
    );

    expect(line?.querySelector('[data-thread-root="older"]')).not.toBeNull();
    expect(line?.querySelector('[data-thread-root="drifted"]')).not.toBeNull();
    expect(container.querySelector('[data-thread-root="tip"]')).toBeNull();
    expect(container.querySelector('[data-testid="review-outdated-threads"]')).toBeNull();
  });

  it("widens to All changes when the opened thread is anchored to another commit", () => {
    state.commits = commitsFixture({ commits: [commitFixture(OLDER), commitFixture(TIP)] });
    state.byScope[OLDER] = { scope: OLDER, files: [FILES[0]!], patch: PATCH } satisfies ReviewDiff;
    state.commentThreads = [
      anchoredThread("tip", "From the tip.", { line: 1, commitSha: TIP }),
    ];
    const container = mountPage(`tab=diff&scope=${OLDER}&thread=tip`);

    expect(lastLocation).toBe(`${storyReviewPath(PROJECT, STORY)}?tab=diff&scope=all&thread=tip`);
    expect(
      fileCard(container, "src/changed.ts").querySelector('[data-thread-root="tip"]'),
    ).not.toBeNull();
  });

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
      expect.any(Object),
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

  it("starts reviewed files collapsed and expands them from the header toggle", () => {
    const container = mountPage("tab=diff");
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
    const container = mountPage("tab=diff");
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
    const container = mountPage("tab=diff");

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
    const container = mountPage("tab=diff");
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
    const container = mountPage("tab=commits");

    expect(container.querySelector('[data-testid="review-empty-diff"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="review-diff-tab"]')).toBeNull();
    expect(container.querySelector('[data-testid="review-commits-tab"]')).toBeNull();
  });

  it("lists All changes, then commits oldest first, and selecting one sets the scope", () => {
    const older = "a3f91c2aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    state.reviews = [
      reviewFixture({
        progress: {
          all: { reviewed: 1, total: 3, changedSinceReviewed: ["src/changed.ts"] },
          commits: {
            [older]: { reviewed: 0, total: 1 },
            [TIP]: { reviewed: 2, total: 2 },
          },
        },
      }),
    ];
    state.commits = commitsFixture({
      commits: [
        {
          sha: older,
          subject: "older change",
          author: "ada",
          authoredAt: "2026-09-27T16:12:00.000Z",
          files: 1,
          additions: 4,
          deletions: 1,
        },
        {
          sha: TIP,
          subject: "newer change",
          author: "grace",
          authoredAt: "2026-09-28T09:05:00.000Z",
          files: 2,
          additions: 8,
          deletions: 0,
        },
      ],
    });
    const container = mountPage("tab=commits");

    const rows = [...container.querySelectorAll("[data-testid='review-scope-row']")];
    expect(rows.map((row) => row.getAttribute("data-scope"))).toEqual(["all", older, TIP]);
    expect(scopeRow(container, "all").textContent).toContain("All changes");
    expect(scopeRow(container, "all").textContent).toContain("3 files");
    expect(scopeRow(container, "all").textContent).toContain("1 / 3 files");
    const olderRow = scopeRow(container, older);
    expect(olderRow.textContent).toContain(shortSha(older));
    expect(olderRow.textContent).toContain("older change");
    expect(olderRow.textContent).toContain("ada");
    expect(olderRow.querySelector("time")?.getAttribute("dateTime")).toBe(
      "2026-09-27T16:12:00.000Z",
    );
    expect(olderRow.textContent).toContain("1 file");
    expect(olderRow.textContent).toContain("0 / 1 files");
    expect(scopeRow(container, TIP).textContent).toContain("2 / 2 files");

    selectScope(olderRow);

    expect(lastLocation).toContain(`scope=${older}`);
    expect(olderRow.getAttribute("data-selected")).toBe("true");
    expect(scopeRow(container, "all").getAttribute("data-selected")).toBe("false");
    expect(olderRow.children).toHaveLength(1);
  });

  it("a commit-scoped mark does not change whole-review progress", () => {
    const commit = "b8e2041aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    state.reviews = [
      reviewFixture({
        progress: {
          all: { reviewed: 1, total: 3, changedSinceReviewed: ["src/changed.ts"] },
          commits: { [commit]: { reviewed: 0, total: 1 } },
        },
      }),
    ];
    state.commits = commitsFixture({
      commits: [
        {
          sha: commit,
          subject: "wire navigator",
          author: "ada",
          authoredAt: "2026-09-27T16:12:00.000Z",
          files: 1,
          additions: 1,
          deletions: 1,
        },
      ],
    });
    state.byScope[commit] = {
      scope: commit,
      files: [FILES[0]],
      patch: PATCH,
    } satisfies ReviewDiff;
    const container = mountPage(`tab=diff&scope=${commit}`);

    expect(container.querySelector('[data-testid="review-scope-label"]')?.textContent).toBe(
      `Commit ${shortSha(commit)} — wire navigator`,
    );
    expect(
      fileCard(container, "src/changed.ts").querySelector(
        '[data-testid="review-changed-since-badge"]',
      ),
    ).toBeNull();
    expect(container.querySelector('[data-testid="review-progress"]')?.textContent).toBe(
      "0 / 1 files reviewed",
    );

    click(reviewedBox(container, "src/changed.ts"));

    expect(state.setMark).toHaveBeenCalledWith(
      { reviewId: "rev-1", scope: commit, path: "src/changed.ts", reviewed: true },
      expect.any(Object),
    );
    expect(container.querySelector('[data-testid="review-progress"]')?.textContent).toBe(
      "1 / 1 files reviewed",
    );

    click(tab(container, "Commits"));

    expect(scopeRow(container, "all").textContent).toContain("1 / 3 files");
    expect(scopeRow(container, commit).textContent).toContain("1 / 1 files");
  });

  it("steps previous and next through All changes and the commits", () => {
    const older = "a3f91c2aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    state.commits = commitsFixture({
      commits: [
        {
          sha: older,
          subject: "older change",
          author: "ada",
          authoredAt: "2026-09-27T16:12:00.000Z",
          files: 1,
          additions: 4,
          deletions: 0,
        },
        {
          sha: TIP,
          subject: "newer change",
          author: "grace",
          authoredAt: "2026-09-28T09:05:00.000Z",
          files: 2,
          additions: 8,
          deletions: 0,
        },
      ],
    });
    const container = mountPage("tab=diff");
    const label = () =>
      container.querySelector('[data-testid="review-scope-label"]')?.textContent;
    const previous = () =>
      container.querySelector<HTMLButtonElement>('[data-testid="review-scope-previous"]')!;
    const next = () =>
      container.querySelector<HTMLButtonElement>('[data-testid="review-scope-next"]')!;

    expect(label()).toBe("All changes");
    expect(previous().disabled).toBe(true);
    expect(state.diffScope).toBe("all");

    click(next());

    expect(lastLocation).toContain(`scope=${older}`);
    expect(label()).toBe(`Commit ${shortSha(older)} — older change`);
    expect(state.diffScope).toBe(older);
    expect(previous().disabled).toBe(false);

    click(next());

    expect(lastLocation).toContain(`scope=${TIP}`);
    expect(label()).toBe(`Commit ${shortSha(TIP)} — newer change`);
    expect(next().disabled).toBe(true);

    click(previous());

    expect(lastLocation).toContain(`scope=${older}`);
    expect(label()).toBe(`Commit ${shortSha(older)} — older change`);
  });

  it("counts path-only and content-only matches and restores the tree when cleared", () => {
    state.diff = {
      scope: "all",
      files: [
        {
          path: "src/needle-path.ts",
          status: "added",
          additions: 1,
          deletions: 0,
          blobSha: "path-1",
          tooLarge: true,
        },
        {
          path: "src/body.ts",
          status: "modified",
          additions: 1,
          deletions: 1,
          blobSha: "body-1",
          tooLarge: false,
        },
        {
          path: "src/quiet.ts",
          status: "modified",
          additions: 1,
          deletions: 0,
          blobSha: "quiet-1",
          tooLarge: false,
        },
      ],
      patch: [
        "diff --git a/src/body.ts b/src/body.ts",
        "index 1111111..2222222 100644",
        "--- a/src/body.ts",
        "+++ b/src/body.ts",
        "@@ -1 +1 @@",
        "-gone",
        "+see needle",
        "diff --git a/src/quiet.ts b/src/quiet.ts",
        "index 3333333..4444444 100644",
        "--- a/src/quiet.ts",
        "+++ b/src/quiet.ts",
        "@@ -1 +1 @@",
        "-old",
        "+unrelated",
      ].join("\n"),
    } satisfies ReviewDiff;
    const container = mountPage("tab=diff");
    const progress = () => container.querySelector("[data-testid='review-progress']")?.textContent;
    expect(progress()).toBe("0 / 3 files reviewed");
    expect(treePaths(container)).toEqual(["src/needle-path.ts", "src/body.ts", "src/quiet.ts"]);

    const input = container.querySelector<HTMLInputElement>("[data-testid='review-diff-search']");
    if (!input) throw new Error("no diff search");
    setInput(input, "NEEDLE");

    expect(container.querySelector("[data-testid='review-diff-search-count']")?.textContent).toBe(
      "1 of 2",
    );
    expect(treePaths(container)).toEqual(["src/needle-path.ts", "src/body.ts"]);
    expect(
      container.querySelector("[data-file-name='src/quiet.ts']"),
    ).toBeNull();
    expect(
      fileCard(container, "src/needle-path.ts").querySelector("[data-testid='review-search-current']")
        ?.textContent,
    ).toBe("needle");
    expect(progress()).toBe("0 / 3 files reviewed");
    expect(state.setMark).not.toHaveBeenCalled();

    click(container.querySelector("[data-testid='review-diff-search-next']")!);

    expect(container.querySelector("[data-testid='review-diff-search-count']")?.textContent).toBe(
      "2 of 2",
    );
    expect(fileCard(container, "src/body.ts").getAttribute("data-search-current")).toBe("true");
    expect(fileCard(container, "src/needle-path.ts").getAttribute("data-search-current")).toBeNull();
    expect(progress()).toBe("0 / 3 files reviewed");
    expect(state.setMark).not.toHaveBeenCalled();

    setInput(input, "");

    expect(container.querySelector("[data-testid='review-diff-search-count']")).toBeNull();
    expect(treePaths(container)).toEqual(["src/needle-path.ts", "src/body.ts", "src/quiet.ts"]);
    expect(progress()).toBe("0 / 3 files reviewed");
  });
});
