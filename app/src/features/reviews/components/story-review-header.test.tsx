// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReviewSubmissionView, ReviewView } from "@server/schemas";
import type { CommentThread } from "@/features/issues/lib/comment-threads";
import { NO_THREADS_INCLUDED } from "../lib/review-submission-ui";
import { StoryReviewHeader } from "./story-review-header";

const state = vi.hoisted(() => ({
  threads: [] as CommentThread[],
  submit: vi.fn(),
  retry: vi.fn(),
  postEvent: vi.fn(),
  createIssue: vi.fn(),
  updateIssue: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return {
    ...actual,
    useNavigate: () => state.navigate,
  };
});

vi.mock("@/features/issues/api/queries", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/issues/api/queries")>();
  return {
    ...actual,
    useReuseCommentThreads: () => ({
      threads: state.threads,
      problems: [],
      loaded: true,
    }),
  };
});

vi.mock("./review-runtime-panel", () => ({
  ReviewRuntimePanel: () => null,
}));

vi.mock("@/features/issues/api/mutations", () => ({
  usePostThreadEvent: () => ({
    mutate: state.postEvent,
    isPending: false,
    variables: undefined,
  }),
  useCreateIssue: () => ({
    mutate: state.createIssue,
    mutateAsync: async (input: unknown) => {
      state.createIssue(input);
      return { id: "idea-new", kind: "idea" };
    },
    isPending: false,
  }),
  useUpdateIssue: () => ({
    mutate: state.updateIssue,
    mutateAsync: async (input: unknown) => {
      state.updateIssue(input);
    },
    isPending: false,
  }),
}));

vi.mock("../api/mutations", () => ({
  useArchiveReview: () => ({ mutate: vi.fn(), isPending: false }),
  useReopenReview: () => ({ mutate: vi.fn(), isPending: false }),
  useSubmitReview: () => ({ mutate: state.submit, isPending: false }),
  useRetryOpenReviewSubmissions: () => ({ mutate: state.retry, isPending: false }),
  useSyncReviewWorktree: () => ({ mutate: vi.fn(), isPending: false }),
}));

function review(overrides: Partial<ReviewView> = {}): ReviewView {
  return {
    id: "rev-1",
    kind: "review",
    partOf: "proj",
    title: "Story",
    story: "story-1",
    archived: false,
    order: 0,
    status: "open",
    createdAt: "2026-09-29T00:00:00.000Z",
    updatedAt: "2026-09-29T00:00:00.000Z",
    marks: { all: {}, commits: {} },
    progress: { all: { reviewed: 0, total: 0, changedSinceReviewed: [] }, commits: {} },
    submissions: [],
    ...overrides,
  } as ReviewView;
}

function readyThread(): CommentThread {
  return commentThread("thread-1", "Please fix this.", true);
}

function commentThread(id: string, body: string, included: boolean): CommentThread {
  return {
    kind: "review",
    state: "open",
    readyToTask: true,
    included,
    replies: [],
    root: {
      id,
      at: "2026-09-29T00:00:00.000Z",
      role: "human",
      body,
    },
  };
}

function failedSubmission(): ReviewSubmissionView {
  return {
    id: "sub-1",
    at: "2026-09-29T12:00:00.000Z",
    status: "failed",
    threadIds: ["thread-1", "thread-2", "thread-3"],
    conversationId: "conv-1",
    error: "Tasking agent stopped — could not append Tasks for 3 threads.",
    round: 1,
    openThreadIds: ["thread-1", "thread-2", "thread-3"],
  };
}

let root: Root | undefined;

function mount(ui: ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  rerender(ui);
  return container;
}

function rerender(ui: ReactNode) {
  act(() => {
    root!.render(<MemoryRouter>{ui}</MemoryRouter>);
  });
}

function listHas(listId: string, threadId: string): boolean {
  return (
    document.body.querySelector(`[data-testid="${listId}"] [data-thread-id="${threadId}"]`) !=
    null
  );
}

function click(element: Element | null | undefined) {
  if (!element) throw new Error("no element to click");
  act(() => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
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

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  state.threads = [];
  state.submit.mockReset();
  state.retry.mockReset();
  state.postEvent.mockReset();
  state.createIssue.mockReset();
  state.updateIssue.mockReset();
  state.navigate.mockReset();
});

afterEach(async () => {
  await act(async () => {
    root?.unmount();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  root = undefined;
  document.body.innerHTML = "";
});

describe("StoryReviewHeader submit", () => {
  it("confirms only the threads being submitted", () => {
    state.threads = [readyThread(), readyThread()];
    state.threads[1] = {
      ...readyThread(),
      root: { ...readyThread().root, id: "thread-2" },
    };
    const container = mount(
      <StoryReviewHeader
        projectId="proj"
        storyId="story-1"
        storyTitle="Story review workbench"
        review={review()}
        merged={false}
      />,
    );
    const button = container.querySelector<HTMLButtonElement>('[data-testid="submit-review"]');
    expect(button?.textContent).toBe("Submit review (2)");
    expect(button?.disabled).toBe(false);
    click(button);

    const dialog = document.body.querySelector('[data-testid="submit-review-dialog"]');
    expect(dialog?.textContent).toContain("Threads to submit (2)");
    expect(dialog?.textContent).not.toContain("Submit as");
    expect(document.body.querySelector('[data-testid="submit-review-summary"]')).toBeNull();
    click(document.body.querySelector('[data-testid="submit-review-confirm"]'));
    expect(state.submit).toHaveBeenCalledWith(
      { reviewId: "rev-1" },
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
    );
    expect(document.body.querySelector('[data-testid="submit-review-dialog"]')).toBeNull();
    expect(container.querySelector('[data-testid="review-tasking-status"]')?.textContent).toContain(
      "Tasking 2 threads…",
    );

    const onError = state.submit.mock.calls[0]?.[1]?.onError as (() => void) | undefined;
    act(() => onError?.());
    expect(document.body.querySelector('[data-testid="submit-review-dialog"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="submit-review"]')).not.toBeNull();
  });

  it("creates a blank append Idea from the follow-up control", async () => {
    mount(
      <StoryReviewHeader
        projectId="proj"
        storyId="story-1"
        storyTitle="Story review workbench"
        review={review()}
        merged={false}
      />,
    );
    click(document.body.querySelector('[data-testid="review-follow-up-idea"]'));
    const title = document.body.querySelector<HTMLInputElement>(
      '[data-testid="review-follow-up-idea-title"]',
    );
    if (!title) throw new Error("no title field");
    setInput(title, "  Grill the outline change  ");
    await act(async () => {
      click(document.body.querySelector('[data-testid="review-follow-up-idea-confirm"]'));
      await Promise.resolve();
    });
    expect(state.createIssue).toHaveBeenCalledWith({
      kind: "idea",
      title: "Grill the outline change",
      partOf: "proj",
    });
    expect(state.updateIssue).toHaveBeenCalledWith({
      id: "idea-new",
      patch: { appendTo: "story-1" },
    });
    expect(state.navigate).toHaveBeenCalled();
  });

  it("hides the follow-up control when the Story is merged", () => {
    mount(
      <StoryReviewHeader
        projectId="proj"
        storyId="story-1"
        storyTitle="Story review workbench"
        review={review()}
        merged={true}
      />,
    );
    expect(document.body.querySelector('[data-testid="review-follow-up-idea"]')).toBeNull();
  });

  it("shows the failure under the branch line and retries every failed submission", () => {
    const container = mount(
      <StoryReviewHeader
        projectId="proj"
        storyId="story-1"
        storyTitle="Story review workbench"
        review={review({ submissions: [failedSubmission()] })}
        merged={false}
      />,
    );
    const storyLink = container.querySelector('[data-testid="review-story-link"]');
    const actions = container.querySelector('[data-testid="review-header-actions"]');
    const error = container.querySelector('[data-testid="review-tasking-error"]');
    expect(storyLink?.compareDocumentPosition(error!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(actions?.compareDocumentPosition(error!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(error?.textContent).toContain(
      "Tasking agent stopped — could not append Tasks for 3 threads.",
    );
    const submit = container.querySelector<HTMLButtonElement>('[data-testid="submit-review"]');
    expect(submit?.textContent).toBe("Submit review (0)");
    expect(submit?.disabled).toBe(true);
    expect(container.querySelectorAll('[data-testid="review-submission-retry"]')).toHaveLength(1);
    click(container.querySelector('[data-testid="review-submission-retry"]'));
    expect(state.retry).toHaveBeenCalledWith(
      "rev-1",
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
    );
    expect(container.querySelector('[data-testid="review-tasking-status"]')?.textContent).toContain(
      "Tasking 3 threads…",
    );
    expect(container.querySelector('[data-testid="review-tasking-error"]')).toBeNull();

    const onError = state.retry.mock.calls[0]?.[1]?.onError as (() => void) | undefined;
    act(() => onError?.());
    expect(container.querySelector('[data-testid="review-submission-retry"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="review-tasking-error"]')?.textContent).toContain(
      "Tasking agent stopped — could not append Tasks for 3 threads.",
    );
  });

  it("moves a thread between the included list and the not-included section", () => {
    state.threads = [
      commentThread("thread-1", "Ship the note.", true),
      commentThread("thread-2", "Held back.", false),
    ];
    let revision = 0;
    const header = () => (
      <StoryReviewHeader
        projectId="proj"
        storyId="story-1"
        storyTitle={`Story review workbench ${revision}`}
        review={review()}
        merged={false}
      />
    );
    const container = mount(header());
    const button = container.querySelector<HTMLButtonElement>('[data-testid="submit-review"]');
    expect(button?.textContent).toBe("Submit review (1)");
    click(button);

    expect(document.body.textContent).toContain("Threads to submit (1)");
    expect(listHas("submit-review-threads", "thread-1")).toBe(true);
    const withheld = document.body.querySelector<HTMLButtonElement>(
      '[data-testid="submit-review-not-included"]',
    );
    expect(withheld?.textContent).toContain("1 not included");
    expect(withheld?.getAttribute("aria-expanded")).toBe("false");
    expect(document.body.textContent).not.toContain("Held back.");
    click(withheld);
    expect(document.body.textContent).toContain("Held back.");
    expect(listHas("submit-review-not-included-threads", "thread-2")).toBe(true);

    click(
      document.body.querySelector(
        '[data-thread-id="thread-1"] [data-testid="thread-inclusion-toggle"]',
      ),
    );
    expect(state.postEvent).toHaveBeenCalledWith({
      threadId: "thread-1",
      event: "excluded",
    });

    state.threads = [
      commentThread("thread-1", "Ship the note.", false),
      commentThread("thread-2", "Held back.", false),
    ];
    revision += 1;
    rerender(header());
    const submit = container.querySelector<HTMLButtonElement>('[data-testid="submit-review"]');
    expect(submit?.textContent).toBe("Submit review (0)");
    expect(submit?.disabled).toBe(true);
    expect(document.body.querySelector('[data-testid="submit-review-dialog"]')).not.toBeNull();
    expect(document.body.textContent).toContain("Threads to submit (0)");
    expect(document.body.textContent).toContain(NO_THREADS_INCLUDED);
    expect(
      document.body.querySelector('[data-testid="submit-review-not-included"]')?.textContent,
    ).toContain("2 not included");
    const confirm = document.body.querySelector<HTMLButtonElement>(
      '[data-testid="submit-review-confirm"]',
    );
    expect(confirm?.disabled).toBe(true);
    expect(listHas("submit-review-not-included-threads", "thread-1")).toBe(true);
    expect(listHas("submit-review-not-included-threads", "thread-2")).toBe(true);

    click(
      document.body.querySelector(
        '[data-thread-id="thread-2"] [data-testid="thread-inclusion-toggle"]',
      ),
    );
    expect(state.postEvent).toHaveBeenCalledWith({
      threadId: "thread-2",
      event: "included",
    });
    state.threads = [
      commentThread("thread-1", "Ship the note.", false),
      commentThread("thread-2", "Held back.", true),
    ];
    revision += 1;
    rerender(header());
    expect(container.querySelector('[data-testid="submit-review"]')?.textContent).toBe(
      "Submit review (1)",
    );
    expect(
      document.body.querySelector<HTMLButtonElement>('[data-testid="submit-review-confirm"]')
        ?.disabled,
    ).toBe(false);
    expect(listHas("submit-review-threads", "thread-2")).toBe(true);
    expect(listHas("submit-review-not-included-threads", "thread-1")).toBe(true);
    expect(
      document.body.querySelector('[data-testid="submit-review-not-included"]')?.textContent,
    ).toContain("1 not included");
  });
});

describe("StoryReviewHeader source line", () => {
  it("uses the primary link color for the story head when commits are absent", () => {
    const container = mount(
      <StoryReviewHeader
        projectId="proj"
        storyId="story-1"
        storyTitle="Story review workbench"
        review={review()}
        merged={false}
      />,
    );
    const storyLink = container.querySelector('[data-testid="review-story-link"]');
    expect(storyLink?.classList.contains("text-primary")).toBe(true);
    expect(storyLink?.textContent).toContain("story-1");
    expect(container.querySelector('[data-testid="review-merge-range"]')).toBeNull();
  });
});
