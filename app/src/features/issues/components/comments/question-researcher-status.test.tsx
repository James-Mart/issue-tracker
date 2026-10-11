// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CommentThread as CommentThreadData } from "../../lib/comment-threads";
import { CommentThread } from "./comment-thread";

const retry = { mutate: vi.fn(), isPending: false };

vi.mock("../../api/mutations", () => ({
  useRetryQuestionResearcher: () => retry,
}));

const question: CommentThreadData = {
  kind: "question",
  state: "open",
  readyToTask: false,
  root: {
    id: "q-root",
    at: "2026-09-29T13:40:00.000Z",
    role: "human",
    name: "Jared",
    kind: "question",
    body: "What happens to in-flight researcher sessions when the review is archived?",
  },
  replies: [],
};

function mount(thread: CommentThreadData): HTMLElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  act(() => {
    createRoot(container).render(
      <CommentThread thread={thread} issueId="story-a" onReply={vi.fn()} />,
    );
  });
  return container.querySelector('[data-thread-root="q-root"]')!;
}

afterEach(() => {
  document.body.innerHTML = "";
  retry.mutate.mockReset();
});

describe("question researcher status", () => {
  it("shows the failure inline and retries the same question", () => {
    const thread = mount({
      ...question,
      researcherRun: {
        status: "failed",
        startedAt: "2026-09-29T13:40:00.000Z",
        error: "the run timed out.",
      },
    });
    const failed = thread.querySelector('[data-testid="researcher-failed"]');
    expect(failed?.querySelector('[role="alert"]')?.textContent).toContain(
      "Researcher couldn't get an answer — the run timed out.",
    );

    expect(failed?.querySelector('[data-testid="researcher-retry"]')).toBeNull();
    act(() => {
      thread
        .querySelector(
          '[data-testid="question-card-footer"] [data-testid="researcher-retry"]',
        )
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(retry.mutate).toHaveBeenCalledWith("q-root");
  });
});
