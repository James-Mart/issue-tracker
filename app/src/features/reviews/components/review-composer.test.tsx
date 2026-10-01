// @vitest-environment happy-dom
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  REVIEW_COMPOSER_LINE_HEIGHT_PX,
  REVIEW_COMPOSER_MAX_LINES,
  REVIEW_COMPOSER_MIN_LINES,
  ReviewComposer,
  ReviewDraftProvider,
  reviewComposerFieldHeight,
} from "./review-composer";

vi.mock("@/features/agents/api/queries", () => ({
  useTranscriptionCapabilityQuery: () => ({
    data: { available: true },
    isLoading: false,
    isError: false,
  }),
}));

function mount(
  props: Partial<ComponentProps<typeof ReviewComposer>> = {},
): { container: HTMLDivElement; root: Root } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <ReviewDraftProvider>
        <ReviewComposer
          draftKey="review:story-1:conversation"
          placeholder="Add a comment"
          submitLabel="Send"
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
          {...props}
        />
      </ReviewDraftProvider>,
    );
  });
  return { container, root };
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
});

describe("reviewComposerFieldHeight", () => {
  const line = REVIEW_COMPOSER_LINE_HEIGHT_PX;
  const padding = 16;
  const border = 2;
  const min = line * REVIEW_COMPOSER_MIN_LINES + padding + border;
  const max = line * REVIEW_COMPOSER_MAX_LINES + padding + border;

  it("starts at three lines and scrolls after twelve", () => {
    expect(reviewComposerFieldHeight(line + padding, line, padding, border)).toEqual({
      height: min,
      scrolls: false,
    });
    const fiveLines = line * 5 + padding;
    expect(reviewComposerFieldHeight(fiveLines, line, padding, border)).toEqual({
      height: fiveLines + border,
      scrolls: false,
    });
    expect(
      reviewComposerFieldHeight(line * 20 + padding, line, padding, border),
    ).toEqual({ height: max, scrolls: true });
  });
});

describe("ReviewComposer", () => {
  it("sends on Enter and keeps a newline on Shift+Enter", () => {
    const onSubmit = vi.fn();
    const { container } = mount({ onSubmit });
    const input = container.querySelector("textarea");
    expect(input).not.toBeNull();
    setDraft(input!, "Ship the note");

    const shiftEnter = new KeyboardEvent("keydown", {
      key: "Enter",
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      input!.dispatchEvent(shiftEnter);
    });
    expect(shiftEnter.defaultPrevented).toBe(false);
    expect(onSubmit).not.toHaveBeenCalled();

    const enter = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      input!.dispatchEvent(enter);
    });
    expect(enter.defaultPrevented).toBe(true);
    expect(onSubmit).toHaveBeenCalledWith("Ship the note");
  });

  it("hides Cancel on an empty persistent composer and shows it with a draft", () => {
    const { container } = mount({ persistent: true });
    expect(container.querySelector('[aria-label="Cancel"]')).toBeNull();
    setDraft(container.querySelector("textarea")!, "A draft");
    expect(container.querySelector('[aria-label="Cancel"]')).not.toBeNull();
  });

  it("closes an empty composer immediately and confirms before discarding text", () => {
    const onCancel = vi.fn();
    const { container } = mount({ onCancel });
    act(() => {
      container
        .querySelector('[aria-label="Cancel"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onCancel).toHaveBeenCalledOnce();
    expect(document.body.querySelector('[data-testid="review-composer-discard-dialog"]')).toBeNull();

    onCancel.mockClear();
    setDraft(container.querySelector("textarea")!, "Keep me");
    const escape = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      container.querySelector("textarea")!.dispatchEvent(escape);
    });
    expect(onCancel).not.toHaveBeenCalled();
    const dialog = document.body.querySelector(
      '[data-testid="review-composer-discard-dialog"]',
    );
    expect(dialog?.textContent).toContain("Discard this draft?");
    expect(dialog?.textContent).toContain("Your text will be lost. This cannot be undone.");
    act(() => {
      dialog
        ?.querySelector('[data-testid="review-composer-discard"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onCancel).toHaveBeenCalledOnce();
    expect(container.querySelector("textarea")?.value).toBe("");
  });

  it("does nothing on Escape when a persistent composer is empty", () => {
    const onCancel = vi.fn();
    const { container } = mount({ persistent: true, onCancel });
    const escape = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      container.querySelector("textarea")!.dispatchEvent(escape);
    });
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("restores a draft for the same key after the composer remounts", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const render = (key: string) => {
      act(() => {
        root.render(
          <ReviewDraftProvider>
            <ReviewComposer
              draftKey={key}
              placeholder="Reply"
              submitLabel="Send"
              onSubmit={vi.fn()}
              onCancel={vi.fn()}
            />
          </ReviewDraftProvider>,
        );
      });
    };
    render("review:story-1:reply:a");
    setDraft(container.querySelector("textarea")!, "draft-a");
    render("review:story-1:reply:b");
    expect(container.querySelector("textarea")?.value).toBe("");
    render("review:story-1:reply:a");
    expect(container.querySelector("textarea")?.value).toBe("draft-a");
  });
});
