// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { CommentThread } from "@/features/issues/lib/comment-threads";
import { ReviewThread } from "./review-thread";

const REVIEW_ID = "story-1-review";
const ROOT_BODY = "Keep the fence:\n\n```ts\nconst x = 1;\n```";
const REPLY_BODY = "See `raw` **source**, not the rendered line.";

vi.mock("@/features/agents/api/queries", () => ({
  useTranscriptionCapabilityQuery: () => ({
    data: { available: true },
    isLoading: false,
    isError: false,
  }),
}));

vi.mock("@/features/issues/api/mutations", () => ({
  usePostComment: () => vi.fn(),
  useEditComment: () => ({ mutateAsync: vi.fn(async () => undefined) }),
  usePostThreadEvent: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn() },
}));

const writeText = vi.fn();

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

const reviewThread = thread({
  root: {
    id: "root",
    at: "2026-09-28T16:40:00.000Z",
    role: "human",
    name: "Ada",
    body: ROOT_BODY,
    editable: true,
  },
  replies: [
    {
      id: "reply",
      at: "2026-09-28T16:45:00.000Z",
      role: "agent",
      name: "Researcher",
      body: REPLY_BODY,
    },
  ],
});

let root: Root | undefined;

function mount(node: ReactNode): HTMLDivElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(node);
  });
  return container;
}

function threadCard(container: ParentNode): HTMLElement {
  const card = container.querySelector('[data-thread-root="root"]');
  if (!(card instanceof HTMLElement)) throw new Error("no thread");
  return card;
}

function comment(card: ParentNode, id: string): HTMLElement {
  const node = card.querySelector(`[data-comment-id="${id}"]`);
  if (!(node instanceof HTMLElement)) throw new Error(`no comment ${id}`);
  return node;
}

function copyButton(card: ParentNode, id: string): HTMLButtonElement {
  const button = comment(card, id).querySelector('[data-testid="comment-copy-markdown"]');
  if (!(button instanceof HTMLButtonElement)) throw new Error(`no copy button on ${id}`);
  return button;
}

function follows(earlier: Node, later: Node): boolean {
  return (earlier.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}

async function click(element: Element | null) {
  if (!element) throw new Error("no element to click");
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  writeText.mockReset();
  writeText.mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  localStorage.clear();
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

describe("review comment Markdown copy", () => {
  it("copies each comment's stored Markdown from an icon under the body", async () => {
    const card = threadCard(mount(<ReviewThread thread={reviewThread} reviewId={REVIEW_ID} />));
    const rootCopy = copyButton(card, "root");
    const replyCopy = copyButton(card, "reply");
    const resolve = card.querySelector('[data-testid="thread-resolve"]');
    const reply = [...card.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Reply"),
    );
    if (!resolve || !reply) throw new Error("missing toolbar");

    expect(rootCopy.textContent).toBe("");
    expect(replyCopy.textContent).toBe("");
    expect(rootCopy.getAttribute("aria-label")).toBe("Copy Markdown");
    expect(follows(comment(card, "root").querySelector(".prose-issue")!, rootCopy)).toBe(true);
    expect(follows(comment(card, "reply").querySelector(".prose-issue")!, replyCopy)).toBe(true);
    expect(follows(rootCopy, resolve)).toBe(true);
    expect(follows(replyCopy, resolve)).toBe(true);
    expect(follows(rootCopy, reply)).toBe(true);
    expect(follows(replyCopy, reply)).toBe(true);

    await click(replyCopy);
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(REPLY_BODY);
    expect(replyCopy.getAttribute("data-copied")).toBe("");

    await click(rootCopy);
    expect(writeText).toHaveBeenLastCalledWith(ROOT_BODY);
    expect(writeText.mock.calls.some((call) => String(call[0]).includes("Ada"))).toBe(false);
    expect(writeText.mock.calls.some((call) => String(call[0]).includes("Researcher"))).toBe(
      false,
    );
  });
});
