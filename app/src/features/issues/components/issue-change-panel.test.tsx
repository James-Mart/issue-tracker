// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { IssueChange } from "@server/schemas";
import { IssueChangePanel } from "./issue-change-panel";

const changeQueryState = vi.hoisted(() => ({
  data: undefined as IssueChange | undefined,
  isLoading: false,
  error: null as Error | null,
}));

vi.mock("@pierre/diffs/react", () => ({
  FileDiff: ({ fileDiff }: { fileDiff: { name: string } }) => (
    <div data-testid="file-diff">{fileDiff.name}</div>
  ),
}));

vi.mock("../api/queries", () => ({
  useIssueChangeQuery: () => ({
    data: changeQueryState.data,
    isLoading: changeQueryState.isLoading,
    error: changeQueryState.error,
  }),
}));

const MULTI_FILE_PATCH = [
  "diff --git a/foo.ts b/foo.ts",
  "index 1111111..2222222 100644",
  "--- a/foo.ts",
  "+++ b/foo.ts",
  "@@ -1 +1,2 @@",
  " line",
  "+added",
  "diff --git a/bar.ts b/bar.ts",
  "index 3333333..4444444 100644",
  "--- a/bar.ts",
  "+++ b/bar.ts",
  "@@ -1 +1,2 @@",
  " other",
  "+added too",
].join("\n");

function mountPanel(): HTMLDivElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<IssueChangePanel issueId="task-1" />);
  });
  return container;
}

afterEach(() => {
  document.body.innerHTML = "";
  changeQueryState.data = undefined;
  changeQueryState.isLoading = false;
  changeQueryState.error = null;
});

describe("IssueChangePanel", () => {
  it("renders one FileDiff per file in a multi-file patch", () => {
    changeQueryState.data = {
      state: "loaded",
      patch: MULTI_FILE_PATCH,
      commits: [{ sha: "0123456789abcdef0123456789abcdef01234567", subject: "Multi" }],
      stats: { filesChanged: 2, insertions: 2, deletions: 0 },
    };

    const container = mountPanel();

    expect(container.querySelector('[data-testid="issue-change-scope-header"]')?.textContent).toBe(
      "2 files +2 -0 1 commit · 0123456",
    );

    const fileDiffs = container.querySelectorAll('[data-testid="file-diff"]');
    expect(fileDiffs).toHaveLength(2);
    expect(fileDiffs[0]?.textContent).toBe("foo.ts");
    expect(fileDiffs[1]?.textContent).toBe("bar.ts");
  });
});
