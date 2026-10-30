// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { CommentThread } from "@/features/issues/lib/comment-threads";
import { ReviewConversationTab } from "./review-conversation-tab";

const SHA = "a4f91c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b";

const state = vi.hoisted(() => ({
  threads: [] as CommentThread[],
  fileText: Array.from({ length: 100 }, (_, index) => `line ${index + 1}`).join("\n"),
}));

const post = vi.hoisted(() => vi.fn());
const resend = vi.hoisted(() => vi.fn());


vi.mock("@/features/agents/api/queries", () => ({
  useTranscriptionCapabilityQuery: () => ({
    data: { available: true },
    isLoading: false,
    isError: false,
  }),
}));

vi.mock("@/features/issues/api/queries", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/issues/api/queries")>();
  return {
    ...actual,
    useCommentsQuery: () => ({
      data: { messages: [], threads: [], problems: [] },
      isLoading: false,
      error: null,
    }),
    useReuseCommentThreads: () => ({ threads: state.threads, problems: [] }),
    useIssueChangeFileQuery: () => ({ data: state.fileText }),
    useIssuesQuery: () => ({ data: { issues: [] } }),
  };
});

vi.mock("@/features/issues/api/mutations", () => ({
  usePostComment: () => post,
  useResendComment: () => resend,
  usePostThreadEvent: () => ({ mutate: vi.fn(), isPending: false }),
  useEditComment: () => ({ mutateAsync: vi.fn(async () => undefined) }),
}));

function thread(overrides: Partial<CommentThread> & Pick<CommentThread, "root">): CommentThread {
  return {
    kind: "review",
    state: "open",
    readyToTask: true,
    replies: [],
    ...overrides,
  };
}

let root: Root | undefined;

function mount(): HTMLDivElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <MemoryRouter initialEntries={["/projects/proj/review/issues/story-1-review"]}>
        <Routes>
          <Route
            path="/projects/:projectId/review/issues/:id"
            element={
              <ReviewConversationTab
                reviewId="story-1-review"
                submissions={[]}
                onOpenInDiff={vi.fn()}
              />
            }
          />
        </Routes>
      </MemoryRouter>,
    );
  });
  return container;
}

function setTextarea(textarea: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value",
  )?.set;
  if (!setter) throw new Error("no textarea value setter");
  act(() => {
    setter.call(textarea, value);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
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
  state.threads = [];
  localStorage.clear();
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

function threadCard(container: ParentNode, threadId: string): HTMLElement {
  const card = container.querySelector(`[data-thread-root="${threadId}"]`);
  if (!(card instanceof HTMLElement)) throw new Error(`no thread ${threadId}`);
  return card;
}

function openReply(card: HTMLElement, text: string): HTMLTextAreaElement {
  click(
    [...card.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Reply"),
    ) ?? null,
  );
  const field = card.querySelector(
    '[data-testid="comment-log-reply-composer"] textarea',
  );
  if (!(field instanceof HTMLTextAreaElement)) throw new Error("no reply field");
  setTextarea(field, text);
  return field;
}

function quoteFieldIn(container: ParentNode): HTMLTextAreaElement {
  const field = container.querySelector(
    '[data-testid="comment-quote-composer"] textarea',
  );
  if (!(field instanceof HTMLTextAreaElement)) throw new Error("no quote field");
  return field;
}

describe("ReviewConversationTab", () => {
  it("opens a new-thread card below the thread and leaves the reply draft", () => {
    state.threads = [
      thread({
        root: {
          id: "note",
          at: "2026-09-28T16:40:00.000Z",
          role: "story-review",
          body: "Name the refusal.",
          anchor: {
            path: "src/header.tsx",
            side: "new",
            line: 12,
            commitSha: SHA,
          },
        },
        replies: [
          {
            id: "reply-1",
            at: "2026-09-28T16:45:00.000Z",
            role: "human",
            body: "One line.\nTwo lines.",
          },
        ],
      }),
    ];
    const container = mount();
    const card = threadCard(container, "note");
    const replyField = openReply(card, "Not yet.");
    const quoteButtons = card.querySelectorAll('[data-testid="comment-quote"]');
    click(quoteButtons[1] ?? null);

    expect(
      document.body.querySelector('[data-testid="review-composer-discard-dialog"]'),
    ).toBeNull();
    expect(replyField.value).toBe("Not yet.");
    expect(
      replyField.closest("[data-draft-key]")?.getAttribute("data-draft-key"),
    ).toBe("review:story-1-review:reply:note");

    const quoteCard = container.querySelector('[data-testid="comment-quote-card"]');
    expect(quoteCard).not.toBeNull();
    expect(card.contains(quoteCard)).toBe(false);
    expect(card.nextElementSibling).toBe(quoteCard);
    expect(
      quoteCard?.querySelector('[data-testid="comment-quote-label"]')?.textContent,
    ).toBe("New thread on src/header.tsx · line 12");
    const quoteField = quoteFieldIn(container);
    expect(quoteField.value).toBe("> One line.\n> Two lines.\n\n");
    expect(quoteField.selectionStart).toBe(quoteField.value.length);
    expect(quoteField.selectionEnd).toBe(quoteField.value.length);
    expect(document.activeElement).toBe(quoteField);
    expect(
      quoteField.closest("[data-draft-key]")?.getAttribute("data-draft-key"),
    ).toBe("review:story-1-review:quote:reply-1");
    expect(
      container.querySelector('[data-testid="comment-quote-composer"]')?.getAttribute(
        "data-comment-id",
      ),
    ).toBe("reply-1");
  });

  it("posts a general comment from the bottom composer and clears it at once", async () => {
    const container = mount();
    const composer = container.querySelector<HTMLTextAreaElement>(
      '[data-testid="review-conversation-composer"] textarea',
    );
    if (!composer) throw new Error("no composer");
    expect(
      container.querySelector(
        '[data-testid="review-conversation-composer"] [aria-label="Cancel"]',
      ),
    ).toBeNull();
    setTextarea(composer, "Ship the note");
    await act(async () => {
      container
        .querySelector('[data-testid="review-conversation-composer"] [aria-label="Send"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(post).toHaveBeenCalledWith({ role: "human", body: "Ship the note" });
    expect(composer.value).toBe("");
  });

  it("keeps a failed comment in place with its error, and Retry resends it", () => {
    state.threads = [
      thread({
        readyToTask: false,
        root: {
          id: "client-1",
          clientId: "client-1",
          at: "2026-09-29T14:05:00.000Z",
          role: "human",
          body: "Reject empty values before formatting.",
          delivery: { status: "failed", error: "Failed to fetch" },
        },
      }),
    ];
    const container = mount();
    expect(container.textContent).toContain("Reject empty values before formatting.");
    expect(container.querySelector('[data-testid="comment-sending"]')).toBeNull();
    const notice = container.querySelector('[role="alert"]');
    expect(notice?.textContent).toContain("Could not send this comment — Failed to fetch");

    click(container.querySelector('[data-testid="comment-send-retry"]'));
    expect(resend).toHaveBeenCalledWith("client-1");
  });
});
