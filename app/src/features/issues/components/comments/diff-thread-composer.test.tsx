// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DiffComposerProvider,
  DiffThreadComposer,
  useDiffComposer,
} from "./diff-thread-composer";

const postComment = vi.hoisted(() => ({
  mutate: vi.fn(),
  isPending: false,
}));

vi.mock("../../api/mutations", () => ({
  usePostComment: () => postComment,
}));

const SHA = "a4f91c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b";

function OpenNew() {
  const { openNew } = useDiffComposer();
  return (
    <button
      type="button"
      data-testid="open-new"
      onClick={() =>
        openNew({
          kind: "new",
          path: "app/foo.ts",
          side: "new",
          line: 94,
        })
      }
    >
      open
    </button>
  );
}

function Host() {
  const { open } = useDiffComposer();
  return (
    <>
      <OpenNew />
      {open ? <DiffThreadComposer target={open} /> : null}
    </>
  );
}

function mount(): HTMLDivElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <DiffComposerProvider issueId="task-threads" commitSha={SHA}>
        <Host />
      </DiffComposerProvider>,
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
  postComment.mutate.mockReset();
  postComment.isPending = false;
});

describe("DiffThreadComposer", () => {
  it("sends on Enter and inserts a newline on Shift+Enter", () => {
    const container = mount();
    act(() => {
      container
        .querySelector('[data-testid="open-new"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const input = container.querySelector("textarea");
    expect(input).not.toBeNull();
    setDraft(input!, "Include issue id in the draft key?");

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
    expect(postComment.mutate).not.toHaveBeenCalled();

    const enter = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      input!.dispatchEvent(enter);
    });
    expect(enter.defaultPrevented).toBe(true);
    expect(postComment.mutate).toHaveBeenCalledWith(
      {
        role: "human",
        body: "Include issue id in the draft key?",
        anchor: {
          path: "app/foo.ts",
          side: "new",
          line: 94,
          commitSha: SHA,
        },
      },
      expect.any(Object),
    );
  });
});
