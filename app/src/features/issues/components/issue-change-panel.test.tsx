// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/errors";
import type { IssueChange } from "@server/schemas";
import {
  classifyIssueChangePanelFault,
  IssueChangePanel,
} from "./issue-change-panel";

const changeQueryState = vi.hoisted(() => ({
  data: undefined as IssueChange | undefined,
  isLoading: false,
  error: null as Error | null,
  isFetching: false,
  refetch: vi.fn(),
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
    isFetching: changeQueryState.isFetching,
    refetch: changeQueryState.refetch,
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
  changeQueryState.isLoading = false;
  changeQueryState.error = null;
  changeQueryState.isFetching = false;
  changeQueryState.refetch.mockReset();
});

describe("classifyIssueChangePanelFault", () => {
  it("maps commit-unreachable API failures", () => {
    expect(
      classifyIssueChangePanelFault(
        new ApiError("fatal: bad object abc", 404, {
          code: "commit-unreachable",
        }),
      ),
    ).toBe("commit-unreachable");
  });

  it("maps workspace-unset validation failures", () => {
    expect(
      classifyIssueChangePanelFault(
        new ApiError("Project workspace is not set", 400, {
          code: "validation",
        }),
      ),
    ).toBe("workspace-unset");
  });

  it("ignores unrelated API failures", () => {
    expect(
      classifyIssueChangePanelFault(
        new ApiError("git binary not found", 503, { code: "git-missing" }),
      ),
    ).toBeUndefined();
  });

  it("maps commits-not-contiguous API failures", () => {
    expect(
      classifyIssueChangePanelFault(
        new ApiError("commits are not contiguous in history between a and b", 400, {
          code: "commits-not-contiguous",
        }),
      ),
    ).toBe("commits-not-contiguous");
  });
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

  it("renders distinct empty content for no-commit", () => {
    changeQueryState.data = { state: "empty", reason: "no-commit" };

    const container = mountPanel();
    const empty = container.querySelector('[data-testid="issue-change-empty-state"]');

    expect(empty?.getAttribute("data-empty-reason")).toBe("no-commit");
    expect(container.textContent).toContain("No commit recorded for this task yet.");
    expect(container.textContent).toContain(
      "When implementation lands and records a commit sha, the combined diff will appear here.",
    );
    expect(container.querySelector('[data-testid="issue-change-fault-state"]')).toBeNull();
  });

  it("renders distinct empty content for no-diff", () => {
    changeQueryState.data = { state: "empty", reason: "no-diff" };

    const container = mountPanel();
    const empty = container.querySelector('[data-testid="issue-change-empty-state"]');

    expect(empty?.getAttribute("data-empty-reason")).toBe("no-diff");
    expect(container.textContent).toContain("This task has no code change.");
    expect(container.textContent).toContain(
      "The tracker has no diff to load for this task. Record a commit if a change should appear here.",
    );
    expect(container.querySelector('[data-testid="issue-change-fault-state"]')).toBeNull();
  });

  it("renders distinct empty content for no-descendant-commits", () => {
    changeQueryState.data = { state: "empty", reason: "no-descendant-commits" };

    const container = mountPanel();
    const empty = container.querySelector('[data-testid="issue-change-empty-state"]');

    expect(empty?.getAttribute("data-empty-reason")).toBe("no-descendant-commits");
    expect(container.textContent).toContain(
      "No descendant tasks have recorded commits yet.",
    );
    expect(container.textContent).toContain(
      "Rollup diffs appear when child tasks finish with commits.",
    );
    expect(container.querySelector('[data-testid="issue-change-fault-state"]')).toBeNull();
  });

  it("renders workspace-unset as a fault with project settings action", () => {
    changeQueryState.error = new ApiError("Project workspace is not set", 400, {
      code: "validation",
    });

    const container = mountPanel();
    const fault = container.querySelector('[data-testid="issue-change-fault-state"]');

    expect(fault?.getAttribute("data-fault")).toBe("workspace-unset");
    expect(container.textContent).toContain("Diff unavailable");
    expect(container.textContent).toContain("Project workspace is not set");
    expect(container.textContent).toContain(
      "Set the project workspace to a checkout on this machine, then reload.",
    );
    expect(container.querySelector('[data-testid="issue-change-empty-state"]')).toBeNull();

    const settingsLink = container.querySelector("a");
    expect(settingsLink?.getAttribute("href")).toBe("/projects/platform");
    expect(settingsLink?.textContent).toBe("Open project settings");
  });

  it("renders commit-unreachable as a fault with reload action", () => {
    changeQueryState.error = new ApiError("fatal: bad object abc", 404, {
      code: "commit-unreachable",
    });

    const container = mountPanel();
    const fault = container.querySelector('[data-testid="issue-change-fault-state"]');

    expect(fault?.getAttribute("data-fault")).toBe("commit-unreachable");
    expect(container.textContent).toContain("Diff unavailable");
    expect(container.textContent).toContain("Commit not found in workspace");
    expect(container.textContent).toContain(
      "Fetch the commit into the project workspace or update the recorded sha on this task.",
    );
    expect(container.textContent).toContain("fatal: bad object abc");
    expect(container.querySelector('[data-testid="issue-change-empty-state"]')).toBeNull();

    const reloadButton = container.querySelector("button");
    expect(reloadButton?.textContent).toBe("Reload diff");
    act(() => {
      reloadButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(changeQueryState.refetch).toHaveBeenCalledTimes(1);
  });

  it("renders commits-not-contiguous as a fault explaining why no rollup diff", () => {
    changeQueryState.error = new ApiError(
      "commits are not contiguous in history between abc and def",
      400,
      { code: "commits-not-contiguous" },
    );

    const container = mountPanel();
    const fault = container.querySelector('[data-testid="issue-change-fault-state"]');

    expect(fault?.getAttribute("data-fault")).toBe("commits-not-contiguous");
    expect(container.textContent).toContain("Diff unavailable");
    expect(container.textContent).toContain("Commits are not contiguous in history");
    expect(container.textContent).toContain(
      "Child tasks recorded commits that are not adjacent in git history, so no combined diff can be shown for this issue.",
    );
    expect(container.textContent).toContain(
      "commits are not contiguous in history between abc and def",
    );
    expect(container.querySelector('[data-testid="issue-change-empty-state"]')).toBeNull();
  });

  it("does not render empty-state chrome for faults", () => {
    changeQueryState.error = new ApiError("fatal: bad object abc", 404, {
      code: "commit-unreachable",
    });

    const container = mountPanel();

    expect(container.querySelector('[data-testid="issue-change-fault-state"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="issue-change-empty-state"]')).toBeNull();
    expect(container.textContent).not.toContain("No commit recorded for this task yet.");
  });
});
