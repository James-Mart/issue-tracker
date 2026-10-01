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
  vi.useRealTimers();
  document.body.innerHTML = "";
  retry.mutate.mockReset();
  retry.isPending = false;
});

describe("question researcher status", () => {
  it("shows Researcher is looking into this… with an elapsed timer while the run is live", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-29T13:41:24.000Z"));
    const thread = mount({
      ...question,
      researcherRun: { status: "running", startedAt: "2026-09-29T13:40:00.000Z" },
    });
    const running = thread.querySelector('[data-testid="researcher-running"]');
    const status = running?.querySelector('[role="status"]');
    expect(status?.textContent).toBe("Researcher is looking into this…");
    expect(status?.getAttribute("aria-live")).toBe("polite");
    expect(running?.querySelector('[data-testid="researcher-elapsed"]')?.textContent).toBe(
      "1:24",
    );
    expect(running?.querySelector('[data-testid="researcher-elapsed"]')?.getAttribute("aria-hidden")).toBe(
      "true",
    );
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(running?.querySelector('[data-testid="researcher-elapsed"]')?.textContent).toBe(
      "1:25",
    );
    expect(thread.querySelector('[data-testid="researcher-retry"]')).toBeNull();
    expect(thread.querySelector('[data-testid="researcher-failed"]')).toBeNull();
    vi.useRealTimers();
  });

  it("shows Posting answer… once the run has ended and no reply is visible yet", () => {
    const thread = mount({
      ...question,
      researcherRun: { status: "finishing", startedAt: "2026-09-29T13:40:00.000Z" },
    });
    const posting = thread.querySelector('[data-testid="researcher-finishing"]');
    const status = posting?.querySelector('[role="status"]');
    expect(status?.textContent).toBe("Posting answer…");
    expect(status?.getAttribute("aria-live")).toBe("polite");
    expect(posting?.querySelector('[data-testid="researcher-elapsed"]')).toBeNull();
    expect(thread.querySelector('[data-testid="researcher-retry"]')).toBeNull();
    expect(thread.querySelector('[data-testid="researcher-failed"]')).toBeNull();
  });

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

  it("leads the question footer with Retry, then Dismiss question and Convert", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    act(() => {
      createRoot(container).render(
        <CommentThread
          thread={{
            ...question,
            researcherRun: {
              status: "failed",
              startedAt: "2026-09-29T13:40:00.000Z",
              error: "the run timed out.",
            },
          }}
          issueId="story-a"
          onReply={vi.fn()}
          onDismiss={vi.fn()}
          onConvert={vi.fn()}
        />,
      );
    });
    const footer = container.querySelector('[data-testid="question-card-footer"]');
    expect(
      [...(footer?.querySelectorAll("button") ?? [])].map((button) =>
        button.textContent?.replace(/\s+/g, " ").trim(),
      ),
    ).toEqual(["Retry", "Dismiss question", "Convert to review comment"]);
  });

  it("disables Retry while a retry is in flight", () => {
    retry.isPending = true;
    const thread = mount({
      ...question,
      researcherRun: {
        status: "failed",
        startedAt: "2026-09-29T13:40:00.000Z",
        error: "the run timed out.",
      },
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
    expect(thread.querySelector('[data-testid="researcher-new-session"]')).toBeNull();
    expect(thread.querySelector('[data-testid="researcher-running"]')).toBeNull();
    expect(thread.querySelector('[data-testid="researcher-failed"]')).toBeNull();
  });

  it("marks a recovered session's reply with a New session note", () => {
    const thread = mount({
      ...question,
      replies: [
        {
          id: "q-answer",
          at: "2026-09-29T14:48:00.000Z",
          role: "agent",
          name: "Researcher",
          replyTo: "q-root",
          body: "After conversion the thread becomes a review comment.",
          newSession: true,
        },
      ],
    });
    const note = thread.querySelector('[data-testid="researcher-new-session"]');
    expect(note?.textContent).toBe("New session");
    expect(note?.parentElement?.textContent).toContain("Researcher");
  });
});
