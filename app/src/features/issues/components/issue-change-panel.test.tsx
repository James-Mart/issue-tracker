// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/errors";
import type { IssueChange } from "@server/schemas";
import { IssueChangePanel } from "./issue-change-panel";

const changeQueryState = vi.hoisted(() => ({
  data: undefined as IssueChange | undefined,
  error: null as Error | null,
}));

vi.mock("@pierre/diffs/react", () => ({
  FileDiff: ({ fileDiff }: { fileDiff: { name: string } }) => (
    <div data-testid="file-diff">{fileDiff.name}</div>
  ),
  Virtualizer: ({ children }: { children: ReactNode }) => (
    <div data-testid="issue-change-virtualizer">{children}</div>
  ),
  useVirtualizer: () => undefined,
}));

vi.mock("../api/mutations", () => ({
  usePostComment: () => vi.fn(),
}));

vi.mock("../api/queries", () => ({
  useIssueChangeQuery: () => ({
    data: changeQueryState.data,
    isLoading: false,
    error: changeQueryState.error,
    isFetching: false,
    refetch: vi.fn(),
  }),
  useReuseCommentThreads: () => ({ threads: [], problems: [] }),
}));

const MULTI_FILE_PATCH = [
  "diff --git a/app/foo.ts b/app/foo.ts",
  "index 1111111..2222222 100644",
  "--- a/app/foo.ts",
  "+++ b/app/foo.ts",
  "@@ -1 +1,3 @@",
  " line",
  "+added",
  "+again",
  "diff --git a/app/bar.ts b/app/bar.ts",
  "index 3333333..4444444 100644",
  "--- a/app/bar.ts",
  "+++ b/app/bar.ts",
  "@@ -1,2 +1 @@",
  "-gone",
  " other",
  "diff --git a/lib/baz.ts b/lib/baz.ts",
  "index 5555555..6666666 100644",
  "--- a/lib/baz.ts",
  "+++ b/lib/baz.ts",
  "@@ -1 +1,2 @@",
  " keep",
  "+new",
].join("\n");

function mountPanel(): HTMLDivElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <MemoryRouter>
        <IssueChangePanel issueId="task-1" projectId="platform" />
      </MemoryRouter>,
    );
  });
  return container;
}

afterEach(() => {
  document.body.innerHTML = "";
  changeQueryState.data = undefined;
  changeQueryState.error = null;
});

function setInputValue(input: HTMLInputElement, next: string) {
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )!.set!;
  act(() => {
    nativeInputValueSetter.call(input, next);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("IssueChangePanel", () => {
  it("lists files from a multi-file patch, filters them, and moves the diff on select", () => {
    changeQueryState.data = {
      state: "loaded",
      patch: MULTI_FILE_PATCH,
      commits: [{ sha: "0123456789abcdef0123456789abcdef01234567", subject: "Multi" }],
      stats: { filesChanged: 3, insertions: 3, deletions: 1 },
    };

    const container = mountPanel();

    expect(container.querySelector('[data-testid="issue-change-scope-header"]')?.textContent).toBe(
      "3 files +3 -1 1 commit · 0123456",
    );

    const listed = Array.from(
      container.querySelectorAll('[data-testid="issue-change-file"]'),
    ).map((el) => ({
      name: el.getAttribute("data-file-name"),
      label: el.textContent,
    }));
    expect(listed).toEqual([
      { name: "app/foo.ts", label: "app/foo.ts+2 -0" },
      { name: "app/bar.ts", label: "app/bar.ts+0 -1" },
      { name: "lib/baz.ts", label: "lib/baz.ts+1 -0" },
    ]);
    expect(container.querySelector('[data-testid="issue-change-file-match-count"]')?.textContent).toBe(
      "3 of 3",
    );
    expect(
      Array.from(container.querySelectorAll('[data-testid="issue-change-file-diff"]')).map((el) =>
        el.getAttribute("data-file-name"),
      ),
    ).toEqual(["app/foo.ts", "app/bar.ts", "lib/baz.ts"]);
    expect(
      Array.from(container.querySelectorAll('[data-testid="file-diff"]')).map((el) => el.textContent),
    ).toEqual(["app/foo.ts", "app/bar.ts", "lib/baz.ts"]);
    expect(container.querySelector('[data-testid="issue-change-virtualizer"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="issue-change-recorded-commits"]')).toBeNull();
    expect(container.querySelector('[data-testid="issue-change-merge-base"]')).toBeNull();
    expect(container.textContent).not.toContain("Changes since");
    expect(
      container
        .querySelector('[data-testid="issue-change-file"][data-file-name="app/foo.ts"]')
        ?.getAttribute("aria-selected"),
    ).toBe("true");

    setInputValue(
      container.querySelector('[data-testid="issue-change-file-filter"]') as HTMLInputElement,
      "app/",
    );

    const narrowed = Array.from(
      container.querySelectorAll('[data-testid="issue-change-file"]'),
    ).map((el) => el.getAttribute("data-file-name"));
    expect(narrowed).toEqual(["app/foo.ts", "app/bar.ts"]);
    expect(container.querySelector('[data-testid="issue-change-file-match-count"]')?.textContent).toBe(
      "2 of 3",
    );
    expect(
      Array.from(container.querySelectorAll('[data-testid="issue-change-file-diff"]')).map((el) =>
        el.getAttribute("data-file-name"),
      ),
    ).toEqual(["app/foo.ts", "app/bar.ts"]);

    act(() => {
      container
        .querySelector('[data-testid="issue-change-file"][data-file-name="app/bar.ts"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(
      container
        .querySelector('[data-testid="issue-change-file-diff"][data-file-name="app/bar.ts"]')
        ?.querySelector('[data-testid="file-diff"]')?.textContent,
    ).toBe("app/bar.ts");
    expect(container.querySelectorAll('[data-testid="file-diff"]')).toHaveLength(2);
    expect(
      container
        .querySelector('[data-testid="issue-change-file"][data-file-name="app/bar.ts"]')
        ?.getAttribute("aria-selected"),
    ).toBe("true");

    setInputValue(
      container.querySelector('[data-testid="issue-change-file-filter"]') as HTMLInputElement,
      "baz",
    );

    expect(
      Array.from(container.querySelectorAll('[data-testid="issue-change-file"]')).map((el) =>
        el.getAttribute("data-file-name"),
      ),
    ).toEqual(["lib/baz.ts"]);
    expect(container.querySelector('[data-testid="issue-change-file-match-count"]')?.textContent).toBe(
      "1 of 3",
    );
    expect(
      container.querySelector('[data-testid="issue-change-file-diff"]')?.getAttribute("data-file-name"),
    ).toBe("lib/baz.ts");
    expect(
      container
        .querySelector('[data-testid="issue-change-file"][data-file-name="lib/baz.ts"]')
        ?.getAttribute("aria-selected"),
    ).toBe("true");

    setInputValue(
      container.querySelector('[data-testid="issue-change-file-filter"]') as HTMLInputElement,
      "no-such-file",
    );

    expect(container.querySelectorAll('[data-testid="issue-change-file"]')).toHaveLength(0);
    expect(container.querySelector('[data-testid="issue-change-file-match-count"]')?.textContent).toBe(
      "0 of 3",
    );
    expect(container.querySelector('[data-testid="issue-change-file-diff"]')).toBeNull();
  });

  it("renders change-too-large as a deliberate refusal with stats and git guidance", () => {
    changeQueryState.error = new ApiError("patch exceeds render ceiling", 413, {
      code: "change-too-large",
      stats: { filesChanged: 100, insertions: 50000, deletions: 100 },
      commitCount: 1,
    });

    const container = mountPanel();
    const refusal = container.querySelector('[data-testid="issue-change-too-large-state"]');

    expect(refusal).not.toBeNull();
    expect(container.textContent).toContain("This change is too large to render in the browser.");
    expect(container.textContent).toContain("100 files +50000 -100 1 commit");
    expect(container.textContent).toContain("git show");
    expect(container.textContent).toContain("git show <commit-sha>");
    expect(container.textContent).not.toContain("Diff unavailable");
    expect(container.querySelector('[data-testid="issue-change-fault-state"]')).toBeNull();
    expect(container.querySelector('[data-testid="issue-change-empty-state"]')).toBeNull();
    expect(container.querySelector('[data-testid="file-diff"]')).toBeNull();
    expect(container.querySelector('[data-testid="issue-change-panel"]')).toBeNull();
  });
});
