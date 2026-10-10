// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReviewSubmissionView, ReviewView } from "@server/schemas";
import type { CommentThread } from "@/features/issues/lib/comment-threads";
import { StoryReviewHeader } from "./story-review-header";

const state = vi.hoisted(() => ({
  threads: [] as CommentThread[],
  submit: vi.fn(),
  retry: vi.fn(),
}));

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

vi.mock("../api/mutations", () => ({
  useArchiveReview: () => ({ mutate: vi.fn(), isPending: false }),
  useReopenReview: () => ({ mutate: vi.fn(), isPending: false }),
  useSubmitReview: () => ({ mutate: state.submit, isPending: false }),
  useRetryOpenReviewSubmissions: () => ({ mutate: state.retry, isPending: false }),
}));

function review(overrides: Partial<ReviewView> = {}): ReviewView {
  return {
    id: "rev-1",
    projectId: "proj",
    target: { kind: "story", storyId: "story-1" },
    status: "open",
    postMortem: false,
    createdAt: "2026-09-29T00:00:00.000Z",
    updatedAt: "2026-09-29T00:00:00.000Z",
    marks: { all: {}, commits: {} },
    progress: { all: { reviewed: 0, total: 0, changedSinceReviewed: [] }, commits: {} },
    effectiveStatus: "open",
    submissions: [],
    ...overrides,
  } as ReviewView;
}

function readyThread(): CommentThread {
  return {
    kind: "review",
    state: "open",
    readyToTask: true,
    replies: [],
    root: {
      id: "thread-1",
      at: "2026-09-29T00:00:00.000Z",
      role: "human",
      body: "Please fix this.",
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
  act(() => {
    root!.render(<MemoryRouter>{ui}</MemoryRouter>);
  });
  return container;
}

function click(element: Element | null | undefined) {
  if (!element) throw new Error("no element to click");
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
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  state.threads = [];
  state.submit.mockReset();
  state.retry.mockReset();
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
  it("posts an optional summary from the dialog", () => {
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
    expect(dialog?.textContent).toContain(
      "Turn 2 unresolved threads into Tasks. An optional summary comment is posted to the Conversation timeline.",
    );
    const summary = document.body.querySelector<HTMLTextAreaElement>(
      '[data-testid="submit-review-summary"]',
    );
    if (!summary) throw new Error("no summary field");
    setTextarea(summary, "  Ship the reachability check.  ");
    click(document.body.querySelector('[data-testid="submit-review-confirm"]'));

    expect(state.submit).toHaveBeenCalledWith(
      { reviewId: "rev-1", summary: "Ship the reachability check." },
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
    );
    expect(document.body.querySelector('[data-testid="submit-review-dialog"]')).toBeNull();
    expect(container.querySelector('[data-testid="review-tasking-status"]')?.textContent).toContain(
      "Tasking 2 threads…",
    );

    const onError = state.submit.mock.calls[0]?.[1]?.onError as (() => void) | undefined;
    act(() => onError?.());
    const restored = document.body.querySelector<HTMLTextAreaElement>(
      '[data-testid="submit-review-summary"]',
    );
    expect(restored?.value).toBe("  Ship the reachability check.  ");
    expect(container.querySelector('[data-testid="submit-review"]')).not.toBeNull();
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
});
