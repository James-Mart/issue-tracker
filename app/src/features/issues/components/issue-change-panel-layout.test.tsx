// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DIFF_LAYOUT_STORAGE_KEY,
  type DiffLayout,
} from "../lib/diff-layout-preference";
import { IssueChangePanel } from "./issue-change-panel";

const changeQueryState = vi.hoisted(() => ({
  data: {
    state: "loaded" as const,
    patch: [
      "diff --git a/foo.ts b/foo.ts",
      "index 1111111..2222222 100644",
      "--- a/foo.ts",
      "+++ b/foo.ts",
      "@@ -1 +1,2 @@",
      " line",
      "+added line",
    ].join("\n"),
    commits: [{ sha: "0123456789abcdef0123456789abcdef01234567", subject: "Add foo" }],
    stats: { filesChanged: 1, insertions: 1, deletions: 0 },
  },
  isLoading: false,
  error: null as Error | null,
  isFetching: false,
  refetch: vi.fn(),
}));

const mobileState = vi.hoisted(() => ({
  value: false,
}));

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => mobileState.value,
}));

vi.mock("@pierre/diffs/react", () => ({
  FileDiff: ({
    fileDiff,
    options,
  }: {
    fileDiff: { name: string };
    options?: { diffStyle?: DiffLayout };
  }) => (
    <div
      data-testid="file-diff"
      data-diff-style={options?.diffStyle ?? "unified"}
    >
      {fileDiff.name}
    </div>
  ),
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
}));

function mountPanel(): { container: HTMLDivElement; root: Root } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <MemoryRouter>
        <IssueChangePanel issueId="task-layout" projectId="issue-tracker" />
      </MemoryRouter>,
    );
  });
  return { container, root };
}

function diffStyle(container: ParentNode): string | null {
  return container
    .querySelector('[data-testid="file-diff"]')
    ?.getAttribute("data-diff-style") ?? null;
}

beforeEach(() => {
  mobileState.value = false;
  localStorage.clear();
});

afterEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
});

describe("IssueChangePanel diff layout toggle", () => {
  it("switches layout when the toggle is clicked", () => {
    const { container } = mountPanel();

    expect(container.querySelector('[data-testid="diff-layout-toggle"]')).not.toBeNull();
    expect(diffStyle(container)).toBe("unified");

    act(() => {
      (
        container.querySelector('[data-layout="split"]') as HTMLButtonElement
      ).click();
    });

    expect(diffStyle(container)).toBe("split");
    expect(localStorage.getItem(DIFF_LAYOUT_STORAGE_KEY)).toBe("split");

    act(() => {
      (
        container.querySelector('[data-layout="unified"]') as HTMLButtonElement
      ).click();
    });

    expect(diffStyle(container)).toBe("unified");
    expect(localStorage.getItem(DIFF_LAYOUT_STORAGE_KEY)).toBe("unified");
  });

  it("restores the stored layout after remount", () => {
    localStorage.setItem(DIFF_LAYOUT_STORAGE_KEY, "split");

    const first = mountPanel();
    expect(diffStyle(first.container)).toBe("split");
    act(() => {
      first.root.unmount();
    });

    const second = mountPanel();
    expect(diffStyle(second.container)).toBe("split");
  });

  it("hides the toggle and forces unified layout at phone width", () => {
    localStorage.setItem(DIFF_LAYOUT_STORAGE_KEY, "split");
    mobileState.value = true;

    const { container } = mountPanel();

    expect(container.querySelector('[data-testid="diff-layout-toggle"]')).toBeNull();
    expect(diffStyle(container)).toBe("unified");
  });
});
