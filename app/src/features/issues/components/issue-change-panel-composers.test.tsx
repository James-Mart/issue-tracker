// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DiffLineAnnotation, FileDiffMetadata } from "@pierre/diffs/react";
import type { CommentMessage, IssueChange } from "@server/schemas";
import type { CommentThread as CommentThreadData } from "../lib/comment-threads";
import { groupCommentThreads } from "../lib/comment-threads";
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

function comment(
  overrides: Partial<CommentMessage> &
    Pick<CommentMessage, "id" | "at" | "body" | "role">,
): CommentMessage {
  return { ...overrides };
}

const currentThread: CommentThreadData = groupCommentThreads([
  comment({
    id: "current-root",
    at: "2026-08-30T14:22:00.000Z",
    role: "code-quality-validator",
    body: "Scope drafts per thread so Diff and Overview stay isolated.",
    anchor: {
      path: "app/server/services/diff-fetch.ts",
      side: "new",
      line: 94,
      commitSha: SHA,
    },
  }),
])[0]!;

const secondThread: CommentThreadData = groupCommentThreads([
  comment({
    id: "second-root",
    at: "2026-08-30T15:00:00.000Z",
    role: "code-quality-validator",
    body: "Second thread on the same file.",
    anchor: {
      path: "app/server/services/diff-fetch.ts",
      side: "new",
      line: 95,
      commitSha: SHA,
    },
  }),
])[0]!;

const changeQueryState = vi.hoisted(() => ({
  data: undefined as IssueChange | undefined,
  isLoading: false,
  error: null as Error | null,
  isFetching: false,
  refetch: vi.fn(),
}));

const threadsState = vi.hoisted(() => ({
  threads: [] as CommentThreadData[],
}));

const postComment = vi.hoisted(() => ({
  mutate: vi.fn(),
  isPending: false,
}));

function annotationsForRow(
  lineAnnotations: DiffLineAnnotation<CommentThreadData[]>[],
  oldLine: number | undefined,
  newLine: number | undefined,
  kind: "context" | "deletion" | "addition",
): DiffLineAnnotation<CommentThreadData[]>[] {
  return lineAnnotations.filter((annotation) => {
    if (
      annotation.side === "deletions" &&
      oldLine !== undefined &&
      annotation.lineNumber === oldLine
    ) {
      return kind === "context" || kind === "deletion";
    }
    if (
      annotation.side === "additions" &&
      newLine !== undefined &&
      annotation.lineNumber === newLine
    ) {
      return kind === "context" || kind === "addition";
    }
    return false;
  });
}

vi.mock("@pierre/diffs/react", () => ({
  FileDiff: function FileDiffMock({
    fileDiff,
    lineAnnotations = [],
    renderAnnotation,
    options,
  }: {
    fileDiff: FileDiffMetadata;
    lineAnnotations?: DiffLineAnnotation<CommentThreadData[]>[];
    renderAnnotation?: (
      annotation: DiffLineAnnotation<CommentThreadData[]>,
    ) => ReactNode;
    options?: {
      onGutterUtilityClick?: (range: {
        start: number;
        end: number;
        side?: "deletions" | "additions";
      }) => void;
      onLineSelected?: (
        range: {
          start: number;
          end: number;
          side?: "deletions" | "additions";
        } | null,
      ) => void;
    };
  }) {
    const rows: ReactNode[] = [];
    const rendered = new Set<string>();
    for (const hunk of fileDiff.hunks) {
      let oldLine = hunk.deletionStart;
      let newLine = hunk.additionStart;
      for (const content of hunk.hunkContent) {
        if (content.type === "context") {
          for (let i = 0; i < content.lines; i++) {
            const kind = "context" as const;
            const rowOld = oldLine;
            const rowNew = newLine;
            rows.push(
              <div
                key={`ctx-${rowOld}-${rowNew}`}
                data-testid="diff-row"
                data-old-line={String(rowOld)}
                data-new-line={String(rowNew)}
              >
                <button
                  type="button"
                  data-testid="diff-start-thread"
                  data-line={String(rowNew)}
                  data-side="additions"
                  onClick={() =>
                    options?.onGutterUtilityClick?.({
                      start: rowNew,
                      end: rowNew,
                      side: "additions",
                    })
                  }
                >
                  Start thread
                </button>
              </div>,
            );
            for (const annotation of annotationsForRow(
              lineAnnotations,
              rowOld,
              rowNew,
              kind,
            )) {
              rendered.add(`${annotation.side}:${annotation.lineNumber}`);
              rows.push(renderAnnotation?.(annotation));
            }
            oldLine++;
            newLine++;
          }
          continue;
        }
        for (let i = 0; i < content.deletions; i++) {
          const rowOld = oldLine;
          rows.push(
            <div
              key={`del-${rowOld}`}
              data-testid="diff-row"
              data-old-line={String(rowOld)}
            >
              <button
                type="button"
                data-testid="diff-start-thread"
                data-line={String(rowOld)}
                data-side="deletions"
                onClick={() =>
                  options?.onGutterUtilityClick?.({
                    start: rowOld,
                    end: rowOld,
                    side: "deletions",
                  })
                }
              >
                Start thread
              </button>
            </div>,
          );
          for (const annotation of annotationsForRow(
            lineAnnotations,
            rowOld,
            undefined,
            "deletion",
          )) {
            rendered.add(`${annotation.side}:${annotation.lineNumber}`);
            rows.push(renderAnnotation?.(annotation));
          }
          oldLine++;
        }
        for (let i = 0; i < content.additions; i++) {
          const rowNew = newLine;
          rows.push(
            <div
              key={`add-${rowNew}`}
              data-testid="diff-row"
              data-new-line={String(rowNew)}
            >
              <button
                type="button"
                data-testid="diff-start-thread"
                data-line={String(rowNew)}
                data-side="additions"
                onClick={() =>
                  options?.onGutterUtilityClick?.({
                    start: rowNew,
                    end: rowNew,
                    side: "additions",
                  })
                }
              >
                Start thread
              </button>
            </div>,
          );
          for (const annotation of annotationsForRow(
            lineAnnotations,
            undefined,
            rowNew,
            "addition",
          )) {
            rendered.add(`${annotation.side}:${annotation.lineNumber}`);
            rows.push(renderAnnotation?.(annotation));
          }
          newLine++;
        }
      }
    }
    for (const annotation of lineAnnotations) {
      if (rendered.has(`${annotation.side}:${annotation.lineNumber}`)) continue;
      rows.push(
        <div
          key={`extra-${annotation.side}-${annotation.lineNumber}`}
          data-testid="diff-extra-annotation"
        >
          {renderAnnotation?.(annotation)}
        </div>,
      );
    }
    return (
      <div data-testid="file-diff">
        {rows}
        <button
          type="button"
          data-testid="diff-select-range"
          onClick={() =>
            options?.onLineSelected?.({
              start: 94,
              end: 95,
              side: "additions",
            })
          }
        >
          Select range
        </button>
      </div>
    );
  },
  Virtualizer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  useVirtualizer: () => undefined,
}));

vi.mock("../api/queries", () => ({
  useIssueChangeQuery: () => ({
    data: changeQueryState.data,
    isLoading: changeQueryState.isLoading,
    error: changeQueryState.error,
    isFetching: changeQueryState.isFetching,
    refetch: changeQueryState.refetch,
  }),
  useCommentThreads: () => ({
    threads: threadsState.threads,
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
  changeQueryState.isLoading = false;
  changeQueryState.error = null;
  changeQueryState.isFetching = false;
  changeQueryState.refetch.mockReset();
  threadsState.threads = [];
  postComment.mutate.mockReset();
  postComment.isPending = false;
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

    expect(postComment.mutate).toHaveBeenCalledWith(
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
      expect.any(Object),
    );
  });

  it("posts a range anchor from a line-range selection", () => {
    loadChange();
    const container = mountPanel();

    act(() => {
      container
        .querySelector('[data-testid="diff-select-range"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const composer = container.querySelector(
      '[data-testid="diff-thread-composer"][data-composer-kind="new"]',
    );
    expect(composer?.textContent).toContain("lines 94-95");

    const input = composer?.querySelector("textarea");
    setDraft(input!, "Comment on the span.");
    sendComposer(container);

    expect(postComment.mutate).toHaveBeenCalledWith(
      {
        role: "human",
        body: "Comment on the span.",
        anchor: {
          path: "app/server/services/diff-fetch.ts",
          side: "new",
          line: 95,
          startLine: 94,
          commitSha: SHA,
        },
      },
      expect.any(Object),
    );
  });

  it("posts a reply with replyTo and no anchor", () => {
    loadChange();
    threadsState.threads = [currentThread];
    const container = mountPanel();

    act(() => {
      container
        .querySelector('[data-thread-root="current-root"] button')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const composer = container.querySelector(
      '[data-testid="diff-thread-composer"][data-composer-kind="reply"]',
    );
    expect(composer).not.toBeNull();

    const input = composer?.querySelector("textarea");
    setDraft(input!, "Agreed. Per-thread draft keys.");
    sendComposer(container);

    expect(postComment.mutate).toHaveBeenCalledWith(
      {
        role: "human",
        body: "Agreed. Per-thread draft keys.",
        replyTo: "current-root",
      },
      expect.any(Object),
    );
    const payload = postComment.mutate.mock.calls[0]?.[0] as {
      anchor?: unknown;
    };
    expect(payload.anchor).toBeUndefined();
  });

  it("keeps drafts isolated per thread", () => {
    loadChange();
    threadsState.threads = [currentThread, secondThread];
    const container = mountPanel();

    act(() => {
      container
        .querySelector('[data-thread-root="current-root"] button')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    setDraft(
      container.querySelector(
        '[data-testid="diff-thread-composer"][data-composer-kind="reply"] textarea',
      ) as HTMLTextAreaElement,
      "draft-current",
    );

    act(() => {
      container
        .querySelector('[data-thread-root="second-root"] button')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const second = container.querySelector(
      '[data-testid="diff-thread-composer"][data-composer-kind="reply"]',
    );
    expect(second?.closest("[data-thread-root]")?.getAttribute("data-thread-root")).toBe(
      "second-root",
    );
    expect((second?.querySelector("textarea") as HTMLTextAreaElement).value).toBe(
      "",
    );
    expect(second?.textContent).not.toContain("draft-current");

    act(() => {
      container
        .querySelector('[data-thread-root="current-root"] button')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const firstAgain = container.querySelector(
      '[data-testid="diff-thread-composer"][data-composer-kind="reply"] textarea',
    ) as HTMLTextAreaElement;
    expect(firstAgain.value).toBe("draft-current");
  });
});
