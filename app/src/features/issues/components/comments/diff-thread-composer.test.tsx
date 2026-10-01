// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DiffComposerProvider,
  DiffThreadComposer,
  useDiffComposer,
} from "./diff-thread-composer";

const postComment = vi.hoisted(() => vi.fn());

vi.mock("@/features/agents/api/queries", () => ({
  useTranscriptionCapabilityQuery: () => ({
    data: { available: true },
    isLoading: false,
    isError: false,
  }),
}));

vi.mock("../../api/mutations", () => ({
  usePostComment: () => postComment,
}));

const SHA = "a4f91c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b";

function OpenNew({ testId, line }: { testId: string; line: number }) {
  const { openNew } = useDiffComposer();
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={() =>
        openNew({
          kind: "new",
          path: "app/foo.ts",
          side: "new",
          line,
        })
      }
    >
      open
    </button>
  );
}

function OpenFile() {
  const { openNew } = useDiffComposer();
  return (
    <button
      type="button"
      data-testid="open-file"
      onClick={() => openNew({ kind: "new", path: "app/foo.ts" })}
    >
      open file
    </button>
  );
}

function Host() {
  const { open } = useDiffComposer();
  return (
    <>
      <OpenNew testId="open-new" line={94} />
      <OpenNew testId="open-other" line={12} />
      <OpenFile />
      {open ? <DiffThreadComposer target={open} /> : null}
    </>
  );
}

function click(container: HTMLElement, testId: string) {
  act(() => {
    container
      .querySelector(`[data-testid="${testId}"]`)
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function mount(allowQuestion = false): HTMLDivElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <DiffComposerProvider
        issueId="task-threads"
        commitSha={SHA}
        allowQuestion={allowQuestion}
      >
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
  localStorage.clear();
  postComment.mockReset();
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
    expect(postComment).not.toHaveBeenCalled();

    const enter = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      input!.dispatchEvent(enter);
    });
    expect(enter.defaultPrevented).toBe(true);
    expect(postComment).toHaveBeenCalledWith({
      role: "human",
      body: "Include issue id in the draft key?",
      anchor: {
        path: "app/foo.ts",
        side: "new",
        line: 94,
        commitSha: SHA,
      },
    });
  });

  it("offers Send and Ask a question on a Story line composer", () => {
    const container = mount(true);
    act(() => {
      container
        .querySelector('[data-testid="open-new"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const input = container.querySelector("textarea");
    expect(input).not.toBeNull();
    setDraft(input!, "Does this short-circuit?");
    act(() => {
      container
        .querySelector('button[aria-label="Ask a question"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(postComment).toHaveBeenCalledWith({
      role: "human",
      body: "Does this short-circuit?",
      kind: "question",
      anchor: {
        path: "app/foo.ts",
        side: "new",
        line: 94,
        commitSha: SHA,
      },
    });
  });

  it("closes the composer and clears its draft as soon as it sends", async () => {
    const container = mount();
    click(container, "open-new");
    setDraft(container.querySelector("textarea")!, "First thread");
    await act(async () => {
      container
        .querySelector('button[aria-label="Send"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(postComment).toHaveBeenCalledOnce();
    expect(container.querySelector('[data-testid="diff-thread-composer"]')).toBeNull();
    expect(localStorage.getItem("review:task-threads:line:app/foo.ts:new:94")).toBeNull();

    click(container, "open-new");
    expect(container.querySelector("textarea")?.value).toBe("");
  });

  it("posts a file anchor for a comment and a question", () => {
    const container = mount(true);
    click(container, "open-file");
    const composer = container.querySelector('[data-testid="diff-thread-composer"]');
    expect(composer?.textContent).not.toMatch(/line \d/);
    expect(composer?.getAttribute("data-draft-key")).toBe(
      "review:task-threads:file:app/foo.ts",
    );
    setDraft(composer!.querySelector("textarea")!, "Move this module.");
    act(() => {
      composer
        ?.querySelector('button[aria-label="Ask a question"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(postComment).toHaveBeenCalledWith({
      role: "human",
      body: "Move this module.",
      kind: "question",
      anchor: { path: "app/foo.ts", commitSha: SHA },
    });
  });
});
