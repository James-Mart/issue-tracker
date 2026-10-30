// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CommentMessage, IssueDetail } from "@server/schemas";
import { IssueCommentsSection } from "./comments-section";

const SHA = "a4f91c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b";

const commentsState = vi.hoisted(() => ({
  messages: [] as CommentMessage[],
}));

const postComment = vi.hoisted(() => vi.fn());

vi.mock("@/features/agents/api/queries", () => ({
  useTranscriptionCapabilityQuery: () => ({
    data: { available: true },
    isLoading: false,
    isError: false,
  }),
}));

vi.mock("../../api/queries", async () => {
  const { groupCommentThreads } = await import("../../lib/comment-threads");
  return {
    useCommentsQuery: () => ({
      data: {
        messages: commentsState.messages,
        threads: [],
        problems: [],
      },
      isLoading: false,
      error: null,
    }),
    useCommentThreads: () => ({
      threads: groupCommentThreads(commentsState.messages, []),
      problems: [],
      loaded: true,
    }),
    useIssuesQuery: () => ({ data: undefined }),
    useIssueChangeFileQuery: () => ({
      data: Array.from({ length: 100 }, (_, index) => `line ${index + 1}`).join(
        "\n",
      ),
    }),
  };
});

vi.mock("../../api/mutations", () => ({
  usePostComment: () => postComment,
  usePostThreadEvent: () => ({ mutate: vi.fn(), isPending: false }),
  useEditComment: () => ({ mutateAsync: vi.fn(async () => undefined) }),
}));

function comment(
  overrides: Partial<CommentMessage> &
    Pick<CommentMessage, "id" | "at" | "body" | "role">,
): CommentMessage {
  return { ...overrides };
}

const unanchoredRoot = comment({
  id: "unanchored-root",
  at: "2026-08-30T11:00:00.000Z",
  role: "planner",
  body: "Fold outdated comments, or keep them in the stream?",
});

const unanchoredReply = comment({
  id: "unanchored-reply",
  at: "2026-08-30T11:20:00.000Z",
  role: "human",
  name: "Jared",
  replyTo: "unanchored-root",
  body: "Same stream — dim them, keep the snippet readable.",
});

const anchoredRoot = comment({
  id: "anchored-root",
  at: "2026-08-30T13:00:00.000Z",
  role: "story-review",
  body: "Scope drafts per thread so Diff and Overview stay isolated.",
  anchor: {
    path: "app/server/services/diff-fetch.ts",
    side: "new",
    line: 94,
    commitSha: SHA,
  },
});

const threadLog: CommentMessage[] = [
  unanchoredRoot,
  unanchoredReply,
  anchoredRoot,
];

function task(): IssueDetail {
  return {
    id: "threads-in-comment-log",
    kind: "task",
    title: "Thread the comment log",
    partOf: "comment-log-threads",
    order: 0,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    needsAttention: false,
    attentionReason: null,
    archived: false,
    description: "",
    version: "1",
    status: "in-progress",
    commits: [],
  };
}

function mount(): HTMLDivElement {
  return mountIssue(task());
}

function story(): Extract<IssueDetail, { kind: "story" }> {
  return {
    id: "handoff",
    kind: "story",
    title: "Human handoff",
    partOf: "runtime-validation-loop",
    order: 0,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    archived: false,
    description: "Story body",
    version: "1",
    labels: [],
    needsAttention: false,
    attentionReason: null,
    branchName: "human-handoff",
    merged: false,
    reviewedTasks: [],
    review: "awaiting-human",
  };
}

function mountIssue(issue: IssueDetail): HTMLDivElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <MemoryRouter>
        <IssueCommentsSection issue={issue} />
      </MemoryRouter>,
    );
  });
  return container;
}

function setDraft(input: HTMLTextAreaElement, value: string) {
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype,
    "value",
  )!.set!;
  act(() => {
    nativeInputValueSetter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

afterEach(() => {
  document.body.innerHTML = "";
  commentsState.messages = [];
  postComment.mockReset();
  localStorage.clear();
});

describe("IssueCommentsSection", () => {
  it("opens a per-thread reply composer and posts replyTo without an anchor", () => {
    commentsState.messages = threadLog;
    const container = mount();

    act(() => {
      container
        .querySelector('[data-thread-root="unanchored-root"] button')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const composer = container.querySelector(
      '[data-testid="comment-log-reply-composer"][data-thread-id="unanchored-root"]',
    );
    expect(composer).not.toBeNull();
    expect(
      container.querySelector(
        '[data-testid="comment-log-reply-composer"][data-thread-id="anchored-root"]',
      ),
    ).toBeNull();

    const input = composer?.querySelector("textarea");
    expect(input).not.toBeNull();
    setDraft(input!, "Will keep drafts scoped to this thread.");

    act(() => {
      composer
        ?.querySelector('button[aria-label="Send"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(postComment).toHaveBeenCalledWith({
      role: "human",
      body: "Will keep drafts scoped to this thread.",
      replyTo: "unanchored-root",
    });
    const payload = postComment.mock.calls[0]?.[0] as {
      anchor?: unknown;
    };
    expect(payload.anchor).toBeUndefined();
    expect(
      container.querySelector(
        '[data-testid="comment-log-reply-composer"][data-thread-id="unanchored-root"]',
      ),
    ).toBeNull();
  });

  it("opens a new-thread card below a story thread and posts a root with the copied anchor", () => {
    commentsState.messages = [anchoredRoot];
    const container = mountIssue(story());
    const card = container.querySelector('[data-thread-root="anchored-root"]');
    if (!(card instanceof HTMLElement)) throw new Error("no thread");

    act(() => {
      [...card.querySelectorAll("button")]
        .find((button) => button.textContent?.includes("Reply"))
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const reply = card.querySelector(
      '[data-testid="comment-log-reply-composer"] textarea',
    );
    if (!(reply instanceof HTMLTextAreaElement)) throw new Error("no reply");
    setDraft(reply, "Leave this reply.");

    act(() => {
      card
        .querySelector('[data-testid="comment-quote"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const quoteCard = container.querySelector('[data-testid="comment-quote-card"]');
    expect(quoteCard).not.toBeNull();
    expect(card.contains(quoteCard)).toBe(false);
    expect(card.nextElementSibling).toBe(quoteCard);
    expect(
      quoteCard?.querySelector('[data-testid="comment-quote-label"]')?.textContent,
    ).toBe("New thread on app/server/services/diff-fetch.ts · line 94");
    const quoteField = quoteCard?.querySelector("textarea");
    if (!(quoteField instanceof HTMLTextAreaElement)) throw new Error("no quote");
    expect(quoteField.value).toBe(
      "> Scope drafts per thread so Diff and Overview stay isolated.\n\n",
    );
    expect(reply.value).toBe("Leave this reply.");

    act(() => {
      quoteCard
        ?.querySelector('[aria-label="Send"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(postComment).toHaveBeenCalledWith({
      role: "human",
      body: "> Scope drafts per thread so Diff and Overview stay isolated.",
      anchor: anchoredRoot.anchor,
    });
    expect(
      (postComment.mock.calls[0]?.[0] as { replyTo?: unknown }).replyTo,
    ).toBeUndefined();
    expect(container.querySelector('[data-testid="comment-quote-card"]')).toBeNull();
    expect(reply.value).toBe("Leave this reply.");
  });
});

