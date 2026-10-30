// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DiffComposerProvider } from "@/features/issues/components/comments/diff-thread-composer";
import type { CommentThread } from "@/features/issues/lib/comment-threads";
import { replyDraftKey } from "@/features/reviews/lib/review-draft-key";
import { ReviewLineThreads } from "./review-thread";

const TIP = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const ANCHOR_SHA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const REVIEW_ID = "story-1-review";
const PATH = "src/header.tsx";

vi.mock("@/features/agents/api/queries", () => ({
  useTranscriptionCapabilityQuery: () => ({
    data: { available: true },
    isLoading: false,
    isError: false,
  }),
}));

vi.mock("@/features/issues/api/queries", () => ({
  useIssueChangeFileQuery: () => ({ data: undefined }),
}));

vi.mock("@/features/issues/api/mutations", () => ({
  usePostComment: () => vi.fn(),
  useEditComment: () => ({ mutateAsync: vi.fn(async () => undefined) }),
  usePostThreadEvent: () => ({ mutate: vi.fn(), isPending: false }),
}));

function thread(overrides: Partial<CommentThread> & Pick<CommentThread, "root">): CommentThread {
  return {
    kind: "review",
    state: "open",
    readyToTask: true,
    included: true,
    replies: [],
    ...overrides,
  };
}

const lineThread = thread({
  root: {
    id: "note",
    at: "2026-09-28T16:40:00.000Z",
    role: "story-review",
    body: "Name the refusal.",
    anchor: { path: PATH, side: "new", line: 12, commitSha: ANCHOR_SHA },
  },
  replies: [
    {
      id: "reply-1",
      at: "2026-09-28T16:45:00.000Z",
      role: "human",
      body: "One line.\nTwo lines.",
    },
  ],
});

let root: Root | undefined;

function mount(node: ReactNode): HTMLDivElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <DiffComposerProvider issueId={REVIEW_ID} commitSha={TIP} allowQuestion>
        {node}
      </DiffComposerProvider>,
    );
  });
  return container;
}

function setTextarea(textarea: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
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

function threadCard(container: ParentNode, threadId: string): HTMLElement {
  const card = container.querySelector(`[data-thread-root="${threadId}"]`);
  if (!(card instanceof HTMLElement)) throw new Error(`no thread ${threadId}`);
  return card;
}

function quoteButtons(card: ParentNode): NodeListOf<Element> {
  return card.querySelectorAll('[data-testid="comment-quote"]');
}

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

describe("Diff tab quote", () => {
  it("opens the line composer outside the thread and leaves the reply draft", () => {
    const container = mount(
      <>
        <ReviewLineThreads threads={[lineThread]} reviewId={REVIEW_ID} />
      </>,
    );
    const card = threadCard(container, "note");
    click(
      [...card.querySelectorAll("button")].find((button) => button.textContent?.includes("Reply")) ??
        null,
    );
    const replyField = card.querySelector("textarea");
    if (!(replyField instanceof HTMLTextAreaElement)) throw new Error("no reply field");
    setTextarea(replyField, "Not yet.");

    click(quoteButtons(card)[1] ?? null);

    expect(document.body.querySelector('[data-testid="review-composer-discard-dialog"]')).toBeNull();
    expect(localStorage.getItem(replyDraftKey(REVIEW_ID, "note"))).toBe("Not yet.");
    const slot = container.querySelector('[data-testid="review-line-threads"]');
    const composer = slot?.querySelector('[data-testid="diff-thread-composer"]');
    expect(composer).not.toBeNull();
    expect(card.contains(composer ?? null)).toBe(false);
    expect(card.nextElementSibling).toBe(composer);
    expect(composer?.textContent).toContain("line 12");
    expect(composer?.querySelector('[data-testid="comment-quote-label"]')).toBeNull();
    const field = composer?.querySelector("textarea");
    if (!(field instanceof HTMLTextAreaElement)) throw new Error("no quote field");
    expect(field.value).toBe("> One line.\n> Two lines.\n\n");
    expect(field.selectionStart).toBe(field.value.length);
    expect(document.activeElement).toBe(field);
    expect(composer?.getAttribute("data-draft-key")).toBe(`review:${REVIEW_ID}:quote:reply-1`);
    expect(composer?.querySelector('[aria-label="Ask a question"]')).not.toBeNull();
  });
});
