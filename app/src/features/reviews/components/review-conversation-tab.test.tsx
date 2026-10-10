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
      <MemoryRouter initialEntries={["/projects/proj/review/stories/story-1"]}>
        <Routes>
          <Route
            path="/projects/:projectId/review/stories/:storyId"
            element={
              <ReviewConversationTab
                storyId="story-1"
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

describe("ReviewConversationTab", () => {
  it("asks before a quote replaces an unsent reply, and keeps the reply when asked", () => {
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
      }),
    ];
    const container = mount();
    const card = container.querySelector('[data-thread-root="note"]');
    click(
      [...(card?.querySelectorAll("button") ?? [])].find((button) =>
        button.textContent?.includes("Reply"),
      ) ?? null,
    );
    const replyField = card?.querySelector(
      '[data-testid="comment-log-reply-composer"] textarea',
    ) as HTMLTextAreaElement;
    setTextarea(replyField, "Not yet.");
    click(card?.querySelector('[data-testid="comment-quote"]') ?? null);
    const dialog = document.body.querySelector(
      '[data-testid="review-composer-discard-dialog"]',
    );
    expect(dialog?.textContent).toContain("Discard this draft?");
    click(
      [...(dialog?.querySelectorAll("button") ?? [])].find((button) =>
        button.textContent?.includes("Keep editing"),
      ) ?? null,
    );
    expect(
      (
        card?.querySelector(
          '[data-testid="comment-log-reply-composer"] textarea',
        ) as HTMLTextAreaElement | null
      )?.value,
    ).toBe("Not yet.");
    expect(card?.querySelector('[data-testid="comment-quote-composer"]')).toBeNull();

    click(card?.querySelector('[data-testid="comment-quote"]') ?? null);
    click(document.body.querySelector('[data-testid="review-composer-discard"]'));
    const quoteField = card?.querySelector(
      '[data-testid="comment-quote-composer"] textarea',
    ) as HTMLTextAreaElement | null;
    expect(quoteField?.value).toBe("Name the refusal.");
    expect(
      card?.querySelector('[data-testid="comment-quote-label"]')?.textContent,
    ).toBe("New thread on src/header.tsx · line 12");
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
