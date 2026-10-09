// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CommentMessage } from "@server/schemas";
import type { CommentThread as CommentThreadData } from "../../lib/comment-threads";
import {
  resetCommentEditStore,
  useCommentEditStore,
} from "../../store/use-comment-edit-store";
import { CommentThread } from "./comment-thread";

vi.mock("@/features/agents/api/queries", () => ({
  useTranscriptionCapabilityQuery: () => ({
    data: { available: true },
    isLoading: false,
    isError: false,
  }),
}));

const BODY = "Improve the 404 error — show the key that was attempted.";

function thread(overrides: Partial<CommentMessage> = {}): CommentThreadData {
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
      ...overrides,
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
  it("shows Edit on an editable comment and hides it otherwise", () => {
    const editable = mount(thread(), vi.fn(async () => undefined));
    const edit = editable.querySelector('[data-testid="comment-edit"]');
    expect(edit?.textContent).toContain("Edit");
    expect(edit?.closest("header")).not.toBeNull();

    const frozen = mount(thread({ editable: false }));
    expect(frozen.querySelector('[data-testid="comment-edit"]')).toBeNull();
    expect(frozen.textContent).toContain(BODY);
  });

  it("swaps the body for the shared composer prefilled with the current text", () => {
    const card = mount(thread(), vi.fn(async () => undefined));
    click(card.querySelector('[data-testid="comment-edit"]'));
    const editing = card.querySelector('[data-testid="pending-comment-edit"]');
    const field = editing?.querySelector("textarea");
    expect(field?.value).toBe(BODY);
    expect(field?.getAttribute("title")).toBe(
      "Enter to save, Shift+Enter for a newline",
    );
    expect(editing?.querySelector('[aria-label="Save"]')).not.toBeNull();
    expect(editing?.querySelector('[aria-label="Cancel"]')).not.toBeNull();
    expect(editing?.querySelector('[data-testid="voice-mic-button"]')).not.toBeNull();
    expect(card.querySelector('[data-testid="comment-edit"]')).toBeNull();
    expect(card.querySelector(".prose-issue")).toBeNull();
  });

  it("closes an unchanged edit without confirmation", () => {
    const card = mount(thread(), vi.fn(async () => undefined));
    click(card.querySelector('[data-testid="comment-edit"]'));
    click(card.querySelector('[aria-label="Cancel"]'));
    expect(card.querySelector('[data-testid="pending-comment-edit"]')).toBeNull();
    expect(
      document.body.querySelector('[data-testid="review-composer-discard-dialog"]'),
    ).toBeNull();
    expect(card.textContent).toContain(BODY);
  });

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

  it("saves the edited body and closes the composer", async () => {
    const onEdit = vi.fn(async () => undefined);
    const card = mount(thread(), onEdit);
    click(card.querySelector('[data-testid="comment-edit"]'));
    setDraft(card.querySelector("textarea")!, "  Revised wording  ");
    click(card.querySelector('[aria-label="Save"]'));
    expect(onEdit).toHaveBeenCalledWith("c1", "Revised wording");
    expect(card.querySelector('[data-testid="pending-comment-edit"]')).toBeNull();
    await act(async () => {
      await onEdit.mock.results[0]?.value;
    });
    expect(localStorage.getItem("review:story-1:edit:c1")).toBeNull();
  });

  it("shows the refusal under the reverted body and hides Edit while a save is in flight", () => {
    useCommentEditStore.getState().fail("c1", 'cannot edit comment "c1": submitted');
    const card = mount(thread(), vi.fn(async () => undefined));
    const fault = card.querySelector('[data-testid="comment-edit-error"]');
    expect(fault?.textContent).toContain('cannot edit comment "c1": submitted');
    expect(fault?.textContent).toContain("The comment is unchanged.");
    expect(card.textContent).toContain(BODY);
    expect(card.querySelector('[data-testid="comment-edit"]')).not.toBeNull();

    act(() => {
      useCommentEditStore.getState().begin("c1");
    });
    const editButton = card.querySelector('[data-testid="comment-edit"]');
    expect(editButton).toBeInstanceOf(HTMLButtonElement);
    expect((editButton as HTMLButtonElement).disabled).toBe(true);
    expect(card.querySelector('[data-testid="comment-edit-error"]')).toBeNull();
  });
});
