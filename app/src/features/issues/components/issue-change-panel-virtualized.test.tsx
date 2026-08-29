// @vitest-environment happy-dom
import { act, useEffect, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FileDiffMetadata } from "@pierre/diffs/react";
import type { IssueChange } from "@server/schemas";
import { IssueChangePanel } from "./issue-change-panel";

const FILE_COUNT = 40;
const LINES_PER_FILE = 25;
const VIEWPORT_FILES = 8;
const FILE_OFFSET = 800;

const changeQueryState = vi.hoisted(() => ({
  data: undefined as IssueChange | undefined,
  isLoading: false,
  error: null as Error | null,
  isFetching: false,
  refetch: vi.fn(),
}));

const viewport = vi.hoisted(() => {
  let start = 0;
  const listeners = new Set<() => void>();
  return {
    size: 8,
    get start() {
      return start;
    },
    setStart(next: number) {
      if (next === start) return;
      start = next;
      for (const notify of listeners) notify();
    },
    reset() {
      start = 0;
    },
    subscribe(notify: () => void) {
      listeners.add(notify);
      return () => {
        listeners.delete(notify);
      };
    },
  };
});

function fileIndexFromName(name: string): number {
  const match = /f(\d+)/.exec(name);
  if (match == null) {
    throw new Error(`expected virtualized test file name, got ${name}`);
  }
  return Number(match[1]);
}

function largeSyntheticPatch(): string {
  return Array.from({ length: FILE_COUNT }, (_, fileIndex) => {
    const name = `src/f${String(fileIndex).padStart(3, "0")}.ts`;
    const added = Array.from(
      { length: LINES_PER_FILE },
      (_, line) => `+line-${fileIndex}-${line}`,
    );
    return [
      `diff --git a/${name} b/${name}`,
      "new file mode 100644",
      "index 0000000..1111111",
      "--- /dev/null",
      `+++ b/${name}`,
      `@@ -0,0 +1,${LINES_PER_FILE} @@`,
      ...added,
    ].join("\n");
  }).join("\n");
}

vi.mock("@pierre/diffs/react", () => ({
  Virtualizer: ({ children }: { children: ReactNode }) => (
    <div data-testid="issue-change-virtualizer">{children}</div>
  ),
  useVirtualizer: () => ({
    getRoot: () => document.body,
    getOffsetInScrollContainer: (element: HTMLElement) => {
      const name = element.getAttribute("data-file-name");
      if (name == null) {
        throw new Error("virtualizer file node is missing data-file-name");
      }
      return fileIndexFromName(name) * FILE_OFFSET;
    },
    scrollTo: ({ top }: { top: number }) => {
      viewport.setStart(Math.round(top / FILE_OFFSET));
    },
  }),
  FileDiff: function FileDiffMock({ fileDiff }: { fileDiff: FileDiffMetadata }) {
    const [, setTick] = useState(0);
    useEffect(() => viewport.subscribe(() => setTick((n) => n + 1)), []);
    const index = fileIndexFromName(fileDiff.name);
    if (index < viewport.start || index >= viewport.start + viewport.size) {
      return null;
    }
    return (
      <div data-testid="file-diff">
        {fileDiff.additionLines.map((line, lineIndex) => (
          <div key={lineIndex} data-testid="diff-row">
            {line}
          </div>
        ))}
      </div>
    );
  },
}));

vi.mock("../api/queries", () => ({
  useIssueChangeQuery: () => ({
    data: changeQueryState.data,
    isLoading: changeQueryState.isLoading,
    error: changeQueryState.error,
    isFetching: changeQueryState.isFetching,
    refetch: changeQueryState.refetch,
  }),
}));

function mountPanel(): HTMLDivElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <MemoryRouter>
        <IssueChangePanel issueId="rollup-1" projectId="issue-tracker" />
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
  viewport.reset();
});

describe("IssueChangePanel virtualized rollup", () => {
  it("materializes a bounded window and brings a distant file into view", () => {
    const patch = largeSyntheticPatch();
    changeQueryState.data = {
      state: "loaded",
      patch,
      commits: [
        { sha: "0123456789abcdef0123456789abcdef01234567", subject: "Large rollup" },
      ],
      stats: { filesChanged: FILE_COUNT, insertions: FILE_COUNT * LINES_PER_FILE, deletions: 0 },
    };

    const container = mountPanel();
    const rowsAtRest = container.querySelectorAll('[data-testid="diff-row"]');
    const totalRows = FILE_COUNT * LINES_PER_FILE;

    expect(container.querySelector('[data-testid="issue-change-virtualizer"]')).not.toBeNull();
    expect(rowsAtRest.length).toBeGreaterThan(0);
    expect(rowsAtRest.length).toBeLessThan(totalRows);
    expect(rowsAtRest.length).toBeLessThanOrEqual(VIEWPORT_FILES * LINES_PER_FILE);
    expect(
      container.querySelector(
        '[data-testid="issue-change-file-diff"][data-file-name="src/f000.ts"] [data-testid="diff-row"]',
      ),
    ).not.toBeNull();
    expect(
      container.querySelector(
        '[data-testid="issue-change-file-diff"][data-file-name="src/f039.ts"] [data-testid="diff-row"]',
      ),
    ).toBeNull();

    act(() => {
      container
        .querySelector('[data-testid="issue-change-file"][data-file-name="src/f039.ts"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(
      container
        .querySelector('[data-testid="issue-change-file"][data-file-name="src/f039.ts"]')
        ?.getAttribute("aria-selected"),
    ).toBe("true");
    expect(
      container.querySelector(
        '[data-testid="issue-change-file-diff"][data-file-name="src/f039.ts"] [data-testid="diff-row"]',
      ),
    ).not.toBeNull();
    expect(
      container.querySelector(
        '[data-testid="issue-change-file-diff"][data-file-name="src/f000.ts"] [data-testid="diff-row"]',
      ),
    ).toBeNull();
    expect(container.querySelectorAll('[data-testid="diff-row"]').length).toBeLessThan(totalRows);
  });
});
