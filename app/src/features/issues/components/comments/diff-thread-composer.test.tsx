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

function mount(): HTMLDivElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <DiffComposerProvider
        issueId="task-threads"
        commitSha={SHA}
        allowQuestion
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
  it("posts a file anchor for a comment and a question", () => {
    const container = mount();
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
