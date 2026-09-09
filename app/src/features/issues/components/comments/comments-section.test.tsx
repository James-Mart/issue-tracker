// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CommentMessage, IssueDetail } from "@server/schemas";
import { IssueCommentsSection } from "./comments-section";

const SHA = "a4f91c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b";

const commentsState = vi.hoisted(() => ({
  messages: [] as CommentMessage[],
  isLoading: false,
  error: null as Error | null,
}));

const postComment = vi.hoisted(() => ({
  mutate: vi.fn(),
  isPending: false,
}));

const useCommentsQuery = vi.hoisted(() =>
  vi.fn(() => ({
    data: { messages: commentsState.messages, problems: [] },
    isLoading: commentsState.isLoading,
    error: commentsState.error,
  })),
);

vi.mock("../../api/queries", () => ({
  useCommentsQuery,
  useIssuesQuery: () => ({ data: undefined }),
}));

vi.mock("../../api/mutations", () => ({
  usePostComment: () => postComment,
}));

function comment(
  overrides: Partial<CommentMessage> &
    Pick<CommentMessage, "id" | "at" | "body" | "role">,
): CommentMessage {
  return { ...overrides };
}

const standaloneEarly = comment({
  id: "standalone-early",
  at: "2026-08-30T10:00:00.000Z",
  role: "human",
  name: "Jared",
  body: "Keep ordinary notes visually lighter than threads.",
});

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

const standaloneLate = comment({
  id: "standalone-late",
  at: "2026-08-30T12:00:00.000Z",
  role: "implementor",
  body: "Wired the Comments panel to the shared thread model.",
});

const anchoredRoot = comment({
  id: "anchored-root",
  at: "2026-08-30T13:00:00.000Z",
  role: "code-quality-validator",
  body: "Scope drafts per thread so Diff and Overview stay isolated.",
  anchor: {
    path: "app/server/services/diff-fetch.ts",
    side: "new",
    line: 94,
    commitSha: SHA,
  },
});

const mixedLog: CommentMessage[] = [
  standaloneLate,
  anchoredRoot,
  unanchoredReply,
  unanchoredRoot,
  standaloneEarly,
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
    blockedBy: [],
    archived: false,
    description: "",
    labels: [],
    status: "in-progress",
    commits: [],
  };
}

function mount(): HTMLDivElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<IssueCommentsSection issue={task()} />);
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
  commentsState.isLoading = false;
  commentsState.error = null;
  postComment.mutate.mockReset();
  postComment.isPending = false;
  useCommentsQuery.mockClear();
});

describe("IssueCommentsSection", () => {
  it("orders mixed roots chronologically and keeps replies flat under their thread", () => {
    commentsState.messages = mixedLog;
    const container = mount();

    expect(
      [...container.querySelectorAll("[data-log-root]")].map((node) =>
        node.getAttribute("data-log-root"),
      ),
    ).toEqual([
      "standalone-early",
      "unanchored-root",
      "standalone-late",
      "anchored-root",
    ]);

    expect(
      container.querySelector('[data-thread-root="standalone-early"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-thread-root="standalone-late"]'),
    ).toBeNull();
    expect(
      container
        .querySelector('[data-log-root="standalone-early"]')
        ?.textContent,
    ).toContain("Keep ordinary notes visually lighter than threads.");
    expect(
      container.querySelector('[data-log-root="standalone-early"] button'),
    ).toBeNull();

    const discussion = container.querySelector(
      '[data-thread-root="unanchored-root"]',
    );
    expect(
      [...(discussion?.querySelectorAll("[data-comment-id]") ?? [])].map(
        (node) => node.getAttribute("data-comment-id"),
      ),
    ).toEqual(["unanchored-root", "unanchored-reply"]);
    expect(discussion?.textContent).toContain(
      "Fold outdated comments, or keep them in the stream?",
    );
    expect(discussion?.textContent).toContain(
      "Same stream — dim them, keep the snippet readable.",
    );
    expect(discussion?.querySelector("button")?.textContent).toContain("Reply");

    const anchored = container.querySelector(
      '[data-thread-root="anchored-root"]',
    );
    expect(
      [...(anchored?.querySelectorAll("[data-comment-id]") ?? [])].map((node) =>
        node.getAttribute("data-comment-id"),
      ),
    ).toEqual(["anchored-root"]);
    expect(anchored?.textContent).toContain(
      "app/server/services/diff-fetch.ts:94 new a4f91c2",
    );
    expect(anchored?.querySelector("button")?.textContent).toContain("Reply");
  });

  it("opens a per-thread reply composer and posts replyTo without an anchor", () => {
    commentsState.messages = mixedLog;
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

    expect(postComment.mutate).toHaveBeenCalledWith(
      {
        role: "human",
        body: "Will keep drafts scoped to this thread.",
        replyTo: "unanchored-root",
      },
      expect.any(Object),
    );
    const payload = postComment.mutate.mock.calls[0]?.[0] as {
      anchor?: unknown;
    };
    expect(payload.anchor).toBeUndefined();
  });
});
