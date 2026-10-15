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
  ReviewAgentRun,
  ReviewCommits,
  ReviewDiff,
  ReviewDiffFile,
  ReviewSubmission,
  ReviewView,
} from "@server/schemas";
import type { CommentThread } from "@/features/issues/lib/comment-threads";
import { shortSha } from "@/lib/utils/short-sha";
import { reviewIssuePath } from "../lib/links";
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
  agentRuns: [] as ReviewAgentRun[],
  wide: true as boolean | undefined,
}));

vi.mock("../hooks/use-wide-review-workbench", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../hooks/use-wide-review-workbench")>();
  return {
    ...actual,
    useWideReviewWorkbench: () => state.wide,
  };
});

vi.mock("@/features/agents/hooks/use-conversation-events", () => ({
  useConversationEvents: () => ({
    events: [
      { type: "assistant", text: "Tokens should 401.", at: "t1", seq: 1 },
    ],
    ready: true,
    historyFailed: false,
    historyError: null,
    refetchHistory: vi.fn(),
    isRefetchingHistory: false,
    pendingText: null,
    streamRunActive: null,
    loadOlder: vi.fn(),
  }),
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
  useIssuesQuery: () => ({
    data: undefined,
    isLoading: true,
    error: null,
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

vi.mock("../hooks/use-review-submission-sync", () => ({
  useReviewRecord: () => ({
    review: {
      data: state.reviews[0],
      error: null,
      isLoading: false,
      isSuccess: true,
      isFetching: false,
    },
    headSynced: true,
  }),
}));

vi.mock("../api/queries", () => ({
  useReviewDiffQuery: (_projectId: string, _reviewId: string, scope: string) => ({
    data: state.byScope[scope] ?? state.diff,
    error: null,
  }),
  useReviewCommitsQuery: () => ({ data: state.commits, error: null, isLoading: false }),
  useReviewRuntimeQuery: () => ({
    data: { state: "stopped" },
    error: null,
    isPending: false,
    isLoading: false,
  }),
  useReviewAgentRunsQuery: () => ({
    data: { runs: state.agentRuns },
    isLoading: false,
    error: null,
  }),
}));

vi.mock("../api/mutations", () => ({
  useSetReviewMark: () => ({ mutate: state.setMark, isPending: false }),
  useArchiveReview: () => ({ mutate: vi.fn(), isPending: false }),
  useReopenReview: () => ({ mutate: vi.fn(), isPending: false }),
  useOpenReview: () => ({ mutate: vi.fn(), isPending: false }),
  useSubmitReview: () => ({ mutate: vi.fn(), isPending: false }),
  useRetryOpenReviewSubmissions: () => ({ mutate: vi.fn(), isPending: false }),
  useSyncReviewWorktree: () => ({ mutate: vi.fn(), isPending: false }),
  useStartReviewRuntime: () => ({ mutate: vi.fn(), isPending: false }),
  useStopReviewRuntime: () => ({ mutate: vi.fn(), isPending: false }),
  useSubmitStandardsGroup: () => ({ mutate: vi.fn(), isPending: false }),
  useRetryStandardsAssessment: () => ({ mutate: vi.fn(), isPending: false }),
  useSetStandardsProposal: () => ({ mutate: vi.fn(), isPending: false }),
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
    kind: "review",
    partOf: PROJECT,
    title: "Story",
    story: STORY,
    archived: false,
    order: 0,
    status: "open",
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
  const path = reviewIssuePath(PROJECT, "rev-1");
  act(() => {
    root!.render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[search ? `${path}?${search}` : path]}>
          <Routes>
            <Route
              path="/projects/:projectId/review/issues/:id"
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
  state.agentRuns = [];
  state.wide = true;
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

  it("opens a phone transcript over the workbench and returns to the Agents tab", () => {
    state.wide = false;
    state.agentRuns = [researcherRun()];
    const container = mountPage("tab=agents");
    expect(container.querySelector('[role="tablist"]')).not.toBeNull();
    expect(container.querySelector("[data-testid='story-review-header']")).not.toBeNull();
    expect(
      container.querySelector('[data-conversation-id="conv-q"]')?.hasAttribute("data-expanded"),
    ).toBe(false);

    click(container.querySelector("[data-testid='agent-run-card-header']")!);

    expect(container.querySelector('[role="tablist"]')).toBeNull();
    expect(container.querySelector("[data-testid='story-review-header']")).toBeNull();
    const screen = container.querySelector("[data-testid='review-phone-transcript']");
    expect(screen?.textContent).toContain("Agents");
    expect(screen?.textContent).toContain("Question researcher");
    expect(screen?.textContent).toContain("Tokens should 401.");
    expect(screen?.querySelector("[data-testid='review-transcript-back']")?.getAttribute("aria-label")).toBe(
      "Back to Agents",
    );
    const open = screen?.querySelector("[data-testid='agent-run-open-in-agents']");
    expect(open?.getAttribute("href")).toBe("/agents/conv-q");
    expect(open?.querySelector("svg")).toBeNull();

    click(screen!.querySelector("[data-testid='review-transcript-back']")!);

    expect(container.querySelector("[data-testid='review-phone-transcript']")).toBeNull();
    expect(container.querySelector('[role="tablist"]')).not.toBeNull();
    expect(
      container.querySelector('[data-review-tab="agents"]')?.getAttribute("aria-selected"),
    ).toBe("true");
    expect(container.querySelector("[data-testid='review-agents-tab']")).not.toBeNull();
  });

  it("opens the latest assessor transcript from the Standards title and returns to that round", () => {
    state.wide = false;
    state.reviews = [{ ...reviewFixture(), submissions: [assessedSubmission()] }];
    state.agentRuns = [assessorRun("conv-old", "2026-10-14T15:00:00.000Z"), assessorRun("conv-new", "2026-10-14T16:00:00.000Z")];
    const container = mountPage("tab=standards");
    const title = container.querySelector("[data-testid='standards-round-transcript']");
    const decision = container.querySelector("[data-testid='standards-decision-accepted']");
    const submit = container.querySelector("[data-testid='standards-submit']");
    expect(title?.textContent).toBe("Round 1");
    expect(title?.contains(decision!)).toBe(false);
    expect(title?.contains(submit!)).toBe(false);

    click(decision!);
    expect(container.querySelector("[data-testid='review-phone-transcript']")).toBeNull();
    expect(container.querySelector("[data-testid='standards-submit']")).not.toBeNull();

    click(title!);

    const screen = container.querySelector("[data-testid='review-phone-transcript']");
    expect(screen?.getAttribute("data-conversation-id")).toBe("conv-new");
    expect(screen?.querySelector("[data-testid='review-transcript-back']")?.getAttribute("aria-label")).toBe(
      "Back to Standards",
    );

    click(screen!.querySelector("[data-testid='review-transcript-back']")!);

    expect(container.querySelector("[data-testid='review-phone-transcript']")).toBeNull();
    expect(
      container.querySelector('[data-review-tab="standards"]')?.getAttribute("aria-selected"),
    ).toBe("true");
    expect(container.querySelector("#standards-group-sub-1")?.textContent).toBe("Round 1");
    expect(container.querySelector("[data-testid='standards-decision-accepted']")).not.toBeNull();
  });
});

function researcherRun(): ReviewAgentRun {
  return {
    conversationId: "conv-q",
    role: "issue-tracker-review-question",
    model: "composer-2.5",
    status: "completed",
    startedAt: "2026-10-14T16:40:00.000Z",
    endedAt: "2026-10-14T16:42:00.000Z",
    questionExcerpt: "Should expired tokens 401?",
    threadId: "thread-1",
  };
}

function doneSubmission(): Extract<ReviewSubmission, { status: "done" }> {
  return {
    id: "sub-1",
    at: "2026-10-14T16:00:00.000Z",
    status: "done",
    threadIds: ["thread-1"],
    taskIds: ["task-1"],
  };
}

function assessedSubmission(): ReviewSubmission {
  return {
    ...doneSubmission(),
    standards: {
      status: "ready",
      doc: { type: "attachment", name: "coding-standards.md" },
      proposals: [
        {
          id: "prop-1",
          section: "Errors",
          before: "old",
          after: "new",
          rationale: "Say what failed.",
          threadIds: ["thread-1"],
        },
      ],
    },
  };
}

function assessorRun(conversationId: string, startedAt: string): ReviewAgentRun {
  return {
    conversationId,
    role: "issue-tracker-standards-assessor",
    model: "composer-2.5",
    status: "completed",
    startedAt,
    endedAt: startedAt,
    round: 1,
    submittedAt: "2026-10-14T16:00:00.000Z",
    submissionId: "sub-1",
  };
}
