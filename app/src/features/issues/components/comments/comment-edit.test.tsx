// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CommentThread as CommentThreadData } from "../../lib/comment-threads";
import { resetCommentEditStore } from "../../store/use-comment-edit-store";
import { CommentThread } from "./comment-thread";

vi.mock("@/features/agents/api/queries", () => ({
  useTranscriptionCapabilityQuery: () => ({
    data: { available: true },
    isLoading: false,
    isError: false,
  }),
}));

const BODY = "Improve the 404 error — show the key that was attempted.";

function thread(): CommentThreadData {
  return {
    kind: "review",
    state: "open",
    readyToTask: true,
    root: {
      id: "c1",
      at: "2026-09-28T16:43:00.000Z",
      role: "human",
      name: "human",
      body: BODY,
      editable: true,
    },
    replies: [],
  };
}

let root: Root | undefined;

function mount(
  data: CommentThreadData,
  onEdit?: (commentId: string, body: string) => Promise<void>,
): HTMLElement {
  act(() => root?.unmount());
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <CommentThread
        thread={data}
        issueId="story-1"
        onReply={vi.fn()}
        onEdit={onEdit}
      />,
    );
  });
  return container.querySelector('[data-thread-root="c1"]')!;
}

function setDraft(input: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype,
    "value",
  )!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function click(element: Element | null | undefined) {
  act(() => {
    element?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  localStorage.clear();
  resetCommentEditStore();
});

describe("pending comment edit", () => {
  it("confirms discard when Cancel follows a change, and keeps the edit when asked", () => {
    const card = mount(thread(), vi.fn(async () => undefined));
    click(card.querySelector('[data-testid="comment-edit"]'));
    setDraft(card.querySelector("textarea")!, "Revised wording");
    click(card.querySelector('[aria-label="Cancel"]'));
    const dialog = document.body.querySelector(
      '[data-testid="review-composer-discard-dialog"]',
    );
    expect(dialog?.textContent).toContain("Discard this draft?");
    click(Array.from(dialog?.querySelectorAll("button") ?? []).find((button) =>
      button.textContent?.includes("Keep editing"),
    ));
    expect(card.querySelector("textarea")?.value).toBe("Revised wording");

    click(card.querySelector('[aria-label="Cancel"]'));
    click(document.body.querySelector('[data-testid="review-composer-discard"]'));
    expect(card.querySelector('[data-testid="pending-comment-edit"]')).toBeNull();
    expect(card.textContent).toContain(BODY);
    expect(localStorage.getItem("review:story-1:edit:c1")).toBeNull();
  });
});
