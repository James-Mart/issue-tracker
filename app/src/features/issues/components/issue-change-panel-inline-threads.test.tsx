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

const outdatedThread: CommentThreadData = groupCommentThreads([
  comment({
    id: "outdated-root",
    at: "2026-08-29T09:15:00.000Z",
    role: "code-quality-validator",
    body: "Run assertCommitReachable before git show.",
    outdated: true,
    anchor: {
      path: "app/server/services/diff-fetch.ts",
      side: "old",
      line: 90,
      startLine: 88,
      commitSha: SHA,
    },
  }),
])[0]!;

const unlocatedThread: CommentThreadData = groupCommentThreads([
  comment({
    id: "unlocated-root",
    at: "2026-08-28T08:00:00.000Z",
    role: "code-quality-validator",
    body: "This line is no longer in the patch.",
    outdated: true,
    anchor: {
      path: "app/server/services/diff-fetch.ts",
      side: "new",
      line: 200,
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
  }: {
    fileDiff: FileDiffMetadata;
    lineAnnotations?: DiffLineAnnotation<CommentThreadData[]>[];
    renderAnnotation?: (
      annotation: DiffLineAnnotation<CommentThreadData[]>,
    ) => ReactNode;
  }) {
    const rows: ReactNode[] = [];
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
              />,
            );
            for (const annotation of annotationsForRow(
              lineAnnotations,
              rowOld,
              rowNew,
              kind,
            )) {
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
            />,
          );
          for (const annotation of annotationsForRow(
            lineAnnotations,
            rowOld,
            undefined,
            "deletion",
          )) {
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
            />,
          );
          for (const annotation of annotationsForRow(
            lineAnnotations,
            undefined,
            rowNew,
            "addition",
          )) {
            rows.push(renderAnnotation?.(annotation));
          }
          newLine++;
        }
      }
    }
    return <div data-testid="file-diff">{rows}</div>;
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

afterEach(() => {
  document.body.innerHTML = "";
  changeQueryState.data = undefined;
  changeQueryState.isLoading = false;
  changeQueryState.error = null;
  changeQueryState.isFetching = false;
  changeQueryState.refetch.mockReset();
  threadsState.threads = [];
});

describe("IssueChangePanel inline threads", () => {
  it("renders current and outdated threads beneath their lines and unlocatable ones at the file end", () => {
    changeQueryState.data = {
      state: "loaded",
      patch: PATCH,
      commits: [{ sha: SHA, subject: "Fetch diff" }],
      stats: { filesChanged: 1, insertions: 1, deletions: 1 },
    };
    threadsState.threads = [currentThread, outdatedThread, unlocatedThread];

    const container = mountPanel();
    const file = container.querySelector(
      '[data-testid="issue-change-file-diff"][data-file-name="app/server/services/diff-fetch.ts"]',
    );
    expect(file).not.toBeNull();

    const current = file?.querySelector('[data-thread-root="current-root"]');
    const currentSlot = current?.closest(
      '[data-testid="issue-change-line-threads"]',
    );
    expect(currentSlot?.getAttribute("data-line")).toBe("94");
    expect(currentSlot?.getAttribute("data-side")).toBe("new");
    expect(currentSlot?.previousElementSibling?.getAttribute("data-new-line")).toBe(
      "94",
    );
    expect(current?.textContent).toContain(
      "Scope drafts per thread so Diff and Overview stay isolated.",
    );

    const outdated = file?.querySelector('[data-thread-root="outdated-root"]');
    const outdatedSlot = outdated?.closest(
      '[data-testid="issue-change-line-threads"]',
    );
    expect(outdatedSlot?.getAttribute("data-line")).toBe("90");
    expect(outdatedSlot?.getAttribute("data-side")).toBe("old");
    expect(outdatedSlot?.previousElementSibling?.getAttribute("data-old-line")).toBe(
      "90",
    );
    expect(outdated?.hasAttribute("data-outdated")).toBe(true);
    expect(outdated?.textContent).toContain(
      "Run assertCommitReachable before git show.",
    );

    const unlocated = file?.querySelector('[data-thread-root="unlocated-root"]');
    const unlocatedSlot = file?.querySelector(
      '[data-testid="issue-change-unlocated-threads"]',
    );
    expect(unlocatedSlot?.contains(unlocated)).toBe(true);
    expect(unlocatedSlot?.previousElementSibling?.getAttribute("data-testid")).toBe(
      "file-diff",
    );
    expect(unlocated?.textContent).toContain(
      "This line is no longer in the patch.",
    );
  });
});
