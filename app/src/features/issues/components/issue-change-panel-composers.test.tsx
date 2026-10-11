// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DiffLineAnnotation, FileDiffMetadata } from "@pierre/diffs/react";
import type { IssueChange } from "@server/schemas";
import { IssueChangePanel } from "./issue-change-panel";

const SHA = "a4f91c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b";

const PATCH = [
  "diff --git a/app/server/services/diff-fetch.ts b/app/server/services/diff-fetch.ts",
  "index 1111111..2222222 100644",
  "--- a/app/server/services/diff-fetch.ts",
  "+++ b/app/server/services/diff-fetch.ts",
  "@@ -88,4 +92,4 @@",
  " line88",
  " line89",
  "-old90",
  "+new94",
  " line91",
].join("\n");

const changeQueryState = vi.hoisted(() => ({
  data: undefined as IssueChange | undefined,
}));

const postComment = vi.hoisted(() => vi.fn());

vi.mock("@/features/agents/api/queries", () => ({
  useTranscriptionCapabilityQuery: () => ({
    data: { available: true },
    isLoading: false,
    isError: false,
  }),
}));

vi.mock("@pierre/diffs/react", () => ({
  FileDiff: function FileDiffMock({
    fileDiff,
    lineAnnotations = [],
    renderAnnotation,
    options,
  }: {
    fileDiff: FileDiffMetadata;
    lineAnnotations?: DiffLineAnnotation<unknown>[];
    renderAnnotation?: (annotation: DiffLineAnnotation<unknown>) => ReactNode;
    options?: {
      onGutterUtilityClick?: (range: {
        start: number;
        end: number;
        side?: "deletions" | "additions";
      }) => void;
    };
  }) {
    const buttons: ReactNode[] = [];
    for (const hunk of fileDiff.hunks) {
      let newLine = hunk.additionStart;
      for (const content of hunk.hunkContent) {
        if (content.type === "context") {
          newLine += content.lines;
          continue;
        }
        for (let i = 0; i < content.additions; i++) {
          const line = newLine++;
          buttons.push(
            <button
              key={line}
              type="button"
              data-testid="diff-start-thread"
              data-line={String(line)}
              data-side="additions"
              onClick={() =>
                options?.onGutterUtilityClick?.({
                  start: line,
                  end: line,
                  side: "additions",
                })
              }
            >
              Start thread
            </button>,
          );
        }
      }
    }
    return (
      <div data-testid="file-diff">
        {buttons}
        {lineAnnotations.map((annotation) => (
          <div key={`${annotation.side}:${annotation.lineNumber}`}>
            {renderAnnotation?.(annotation)}
          </div>
        ))}
      </div>
    );
  },
  Virtualizer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  useVirtualizer: () => undefined,
}));

vi.mock("../api/queries", () => ({
  useIssueChangeQuery: () => ({
    data: changeQueryState.data,
    isLoading: false,
    error: null,
    isFetching: false,
    refetch: vi.fn(),
  }),
  useReuseCommentThreads: () => ({
    threads: [],
    problems: [],
  }),
}));

vi.mock("../api/mutations", () => ({
  usePostComment: () => postComment,
}));

function mountPanel(): HTMLDivElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <MemoryRouter>
        <IssueChangePanel issueId="task-threads" projectId="issue-tracker" />
      </MemoryRouter>,
    );
  });
  return container;
}

function loadChange(): void {
  changeQueryState.data = {
    state: "loaded",
    patch: PATCH,
    commits: [
      { sha: "1111111111111111111111111111111111111111", subject: "Earlier" },
      { sha: SHA, subject: "Head of the rendered change" },
    ],
    stats: { filesChanged: 1, insertions: 1, deletions: 1 },
  };
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

function sendComposer(container: ParentNode): void {
  const send = container.querySelector(
    '[data-testid="diff-thread-composer"] button[aria-label="Send"]',
  );
  act(() => {
    send?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

afterEach(() => {
  document.body.innerHTML = "";
  changeQueryState.data = undefined;
  postComment.mockReset();
});

describe("IssueChangePanel composers", () => {
  it("posts a single-line anchor from the per-line affordance using the change head", () => {
    loadChange();
    const container = mountPanel();

    act(() => {
      container
        .querySelector(
          '[data-testid="diff-start-thread"][data-line="94"][data-side="additions"]',
        )
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const composer = container.querySelector(
      '[data-testid="diff-thread-composer"][data-composer-kind="new"]',
    );
    expect(composer).not.toBeNull();
    expect(composer?.textContent).toContain("Start a review thread");
    expect(composer?.textContent).toContain("line 94");

    const input = composer?.querySelector("textarea");
    setDraft(input!, "Include issue id in the draft key?");
    sendComposer(container);

    expect(postComment).toHaveBeenCalledWith(
      {
        role: "human",
        body: "Include issue id in the draft key?",
        anchor: {
          path: "app/server/services/diff-fetch.ts",
          side: "new",
          line: 94,
          commitSha: SHA,
        },
      },
    );
  });
});
