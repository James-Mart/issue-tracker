// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { IssueChange, IssueDetail } from "@server/schemas";
import { IssueDetailTabs } from "./issue-detail-tabs";

const changeQueryState = vi.hoisted(() => ({
  data: undefined as IssueChange | undefined,
  isLoading: false,
  error: null as Error | null,
}));

vi.mock("../hooks/use-channel-tab-indicator", () => ({
  useChannelTabIndicator: () => null,
}));

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => false,
}));

vi.mock("./channel-transcript-panel", () => ({
  ChannelTranscriptPanel: () => <div data-testid="channel-transcript-panel" />,
}));

vi.mock("./supporting-doc-preview", () => ({
  SupportingDocPreview: () => <div data-testid="supporting-doc-preview" />,
}));

vi.mock("./agent-runs-panel", () => ({
  AgentRunsPanel: () => <div data-testid="agent-runs-panel" />,
}));

vi.mock("@pierre/diffs/react", () => ({
  FileDiff: ({ fileDiff }: { fileDiff: { name: string } }) => (
    <div data-testid="file-diff">{fileDiff.name}</div>
  ),
}));

vi.mock("../api/queries", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/queries")>();
  return {
    ...actual,
    useIssueAgentRunsQuery: () => ({
      data: { runs: [] },
      isLoading: false,
      error: null,
    }),
    useIssueChangeQuery: () => ({
      data: changeQueryState.data,
      isLoading: changeQueryState.isLoading,
      error: changeQueryState.error,
    }),
  };
});

const t0 = "2026-08-01T00:00:00.000Z";

function task(): IssueDetail {
  return {
    id: "task-diff-tab",
    kind: "task",
    title: "Wire Diff tab panel",
    partOf: "story-1",
    order: 0,
    createdAt: t0,
    updatedAt: t0,
    blockedBy: [],
    archived: false,
    description: "",
    labels: [],
  };
}

function idea(): IssueDetail {
  return {
    id: "capture",
    kind: "idea",
    title: "Capture",
    partOf: "issue-tracker",
    order: 0,
    createdAt: t0,
    updatedAt: t0,
    blockedBy: [],
    archived: false,
    description: "",
    labels: [],
  };
}

function epic(): IssueDetail {
  return {
    id: "epic-1",
    kind: "epic",
    title: "Hierarchical diff views",
    partOf: "issue-tracker",
    order: 0,
    createdAt: t0,
    updatedAt: t0,
    blockedBy: [],
    archived: false,
    description: "",
    labels: [],
  };
}

function story(): IssueDetail {
  return {
    id: "story-1",
    kind: "story",
    title: "Rollup grain",
    partOf: "epic-1",
    order: 0,
    createdAt: t0,
    updatedAt: t0,
    blockedBy: [],
    archived: false,
    description: "",
    labels: [],
  };
}

function mountTabs(
  issue: IssueDetail,
  initialEntry = "/",
): { container: HTMLDivElement; root: Root } {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[initialEntry]}>
          <IssueDetailTabs
            issue={issue}
            projectId="issue-tracker"
            overview={<div>Overview body</div>}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  return { container, root };
}

afterEach(() => {
  document.body.innerHTML = "";
  changeQueryState.data = undefined;
  changeQueryState.isLoading = false;
  changeQueryState.error = null;
});

describe("IssueDetailTabs diff tab", () => {
  it("offers Diff for Task, Story, and Epic but not for Idea", () => {
    const taskTabLabels = Array.from(
      mountTabs(task()).container.querySelectorAll('[role="tab"]'),
    ).map((el) => el.textContent?.trim());
    expect(taskTabLabels.some((label) => label?.includes("Diff"))).toBe(true);

    const storyTabLabels = Array.from(
      mountTabs(story()).container.querySelectorAll('[role="tab"]'),
    ).map((el) => el.textContent?.trim());
    expect(storyTabLabels.some((label) => label?.includes("Diff"))).toBe(true);

    const epicTabLabels = Array.from(
      mountTabs(epic()).container.querySelectorAll('[role="tab"]'),
    ).map((el) => el.textContent?.trim());
    expect(epicTabLabels.some((label) => label?.includes("Diff"))).toBe(true);

    const ideaTabLabels = Array.from(
      mountTabs(idea()).container.querySelectorAll('[role="tab"]'),
    ).map((el) => el.textContent?.trim());
    expect(ideaTabLabels.some((label) => label?.includes("Diff"))).toBe(false);
  });

  it("renders a loaded change patch and header stats", () => {
    changeQueryState.data = {
      state: "loaded",
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
      stats: { filesChanged: 2, insertions: 34, deletions: 12 },
    };

    const { container } = mountTabs(task(), "/?tab=diff");

    const header = container.querySelector('[data-testid="issue-change-scope-header"]');
    expect(header?.textContent).toBe("2 files +34 -12 1 commit · 0123456");

    const fileDiffs = container.querySelectorAll('[data-testid="file-diff"]');
    expect(fileDiffs).toHaveLength(1);
    expect(fileDiffs[0]?.textContent).toBe("foo.ts");
  });
});
