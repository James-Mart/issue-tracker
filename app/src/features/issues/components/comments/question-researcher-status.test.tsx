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
  retry.isPending = false;
});

describe("question researcher status", () => {
  it("shows Researching… while the run is live", () => {
    const thread = mount({ ...question, researcherRun: { status: "running" } });
    const running = thread.querySelector('[data-testid="researcher-running"]');
    expect(running?.textContent).toBe("Researching…");
    expect(running?.getAttribute("role")).toBe("status");
    expect(running?.getAttribute("aria-live")).toBe("polite");
    expect(thread.querySelector('[data-testid="researcher-failed"]')).toBeNull();
  });

  it("shows the failure inline and retries the same question", () => {
    const thread = mount({
      ...question,
      researcherRun: { status: "failed", error: "the run timed out." },
    });
    const failed = thread.querySelector('[data-testid="researcher-failed"]');
    expect(failed?.querySelector('[role="alert"]')?.textContent).toContain(
      "Researcher couldn't get an answer — the run timed out.",
    );

    act(() => {
      failed
        ?.querySelector('[data-testid="researcher-retry"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(retry.mutate).toHaveBeenCalledWith("q-root");
  });

  it("disables Retry while a retry is in flight", () => {
    retry.isPending = true;
    const thread = mount({
      ...question,
      researcherRun: { status: "failed", error: "the run timed out." },
    });
    expect(
      thread
        .querySelector('[data-testid="researcher-retry"]')
        ?.hasAttribute("disabled"),
    ).toBe(true);
  });

  it("credits an answered question's reply to the Researcher and drops the status", () => {
    const thread = mount({
      ...question,
      replies: [
        {
          id: "q-answer",
          at: "2026-09-29T13:42:00.000Z",
          role: "agent",
          name: "Researcher",
          replyTo: "q-root",
          body: "They keep running; archiving only hides the review.",
        },
      ],
    });
    const header = thread.querySelector('[data-comment-id="q-answer"] header');
    expect(header?.querySelector("svg")).not.toBeNull();
    expect(header?.textContent).toContain("Researcher");
    expect(thread.querySelector('[data-testid="researcher-running"]')).toBeNull();
    expect(thread.querySelector('[data-testid="researcher-failed"]')).toBeNull();
  });
});
