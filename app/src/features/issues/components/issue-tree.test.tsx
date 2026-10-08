// @vitest-environment happy-dom
import { act } from "react";
import type { ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IssueRecord } from "@server/schemas";
import type { PrFacts } from "@server/services/delivery";
import type { OverviewRowProps } from "@/components/ui/overview-row";
import { issuesKeys } from "../api/keys";
import type { IssueNode } from "../lib/build-tree";
import { useIssueUiStore } from "../store/use-issue-ui-store";
import { IssueTree } from "./issue-tree";

const rowRenders = vi.hoisted(() => ({ titles: [] as string[] }));

vi.mock("@/components/ui/overview-row", async () => {
  const actual = await vi.importActual<typeof import("@/components/ui/overview-row")>(
    "@/components/ui/overview-row",
  );
  return {
    ...actual,
    OverviewRow: (props: OverviewRowProps) => {
      rowRenders.titles.push(overviewTitle(props.children));
      return <actual.OverviewRow {...props} />;
    },
  };
});

function overviewTitle(children: ReactNode): string {
  if (
    children &&
    typeof children === "object" &&
    "props" in children &&
    children.props &&
    typeof children.props === "object" &&
    "children" in children.props &&
    typeof children.props.children === "string"
  ) {
    return children.props.children;
  }
  return "";
}

const t0 = "2026-08-10T12:00:00.000Z";

function facts(number: number, commentCount: number): PrFacts {
  return {
    number,
    url: `https://github.com/acme/widgets/pull/${number}`,
    state: "open",
    isDraft: false,
    mergeable: "mergeable",
    mergeStateStatus: "CLEAN",
    reviewDecision: "approved",
    checks: { state: "success", failing: 0, pending: 0, total: 1 },
    commentCount,
    comments: [],
    headRefOid: "abc123",
    baseRefName: "main",
    updatedAt: "2026-08-01T00:00:00Z",
  };
}

function story(
  id: string,
  title: string,
  prUrl: string,
  partOf = "epic-1",
): IssueRecord {
  return {
    id,
    kind: "story",
    title,
    partOf,
    order: 0,
    branchName: id,
    merged: false,
    reviewedTasks: [],
    needsAttention: false,
    attentionReason: null,
    archived: false,
    prUrl,
    createdAt: t0,
    updatedAt: t0,
  };
}

function task(id: string, title: string, partOf: string): IssueRecord {
  return {
    id,
    kind: "task",
    title,
    partOf,
    status: "todo",
    commits: [],
    order: 0,
    needsAttention: false,
    attentionReason: null,
    archived: false,
    createdAt: t0,
    updatedAt: t0,
  };
}

function epic(): IssueRecord {
  return {
    id: "epic-1",
    kind: "epic",
    title: "Epic",
    partOf: "proj",
    order: 0,
    needsAttention: false,
    attentionReason: null,
    archived: false,
    blockedBy: [],
    createdAt: t0,
    updatedAt: t0,
  };
}

const storyA = story("story-a", "Story A", "https://github.com/acme/widgets/pull/1");
const storyB = story("story-b", "Story B", "https://github.com/acme/widgets/pull/2");
const taskA = task("task-a", "Task A", "story-a");
const taskB = task("task-b", "Task B", "story-b");
const epicIssue = epic();
const issues = [epicIssue, storyA, storyB, taskA, taskB];
const nodes: IssueNode[] = [
  {
    issue: epicIssue,
    children: [
      { issue: storyA, children: [{ issue: taskA, children: [] }] },
      { issue: storyB, children: [{ issue: taskB, children: [] }] },
    ],
  },
];

const doneEpic: IssueRecord = { ...epicIssue, id: "epic-done", title: "Done Epic" };
const doneStory = story(
  "story-done",
  "Done Story",
  "https://github.com/acme/widgets/pull/3",
  "epic-done",
);
const doneTask = task("task-done", "Done Task", "story-done");
const doneNodes: IssueNode[] = [
  {
    issue: doneEpic,
    children: [
      { issue: doneStory, children: [{ issue: doneTask, children: [] }] },
    ],
  },
];

function takeTitles(): string[] {
  const titles = [...rowRenders.titles];
  rowRenders.titles.length = 0;
  return titles;
}

describe("IssueTree", () => {
  let container: HTMLDivElement;
  let root: Root;
  let client: QueryClient;
  const expanded = useIssueUiStore.getState().expanded;

  function renderTree(treeIssues: IssueRecord[], treeDoneNodes?: IssueNode[]) {
    act(() => {
      root.render(
        <QueryClientProvider client={client}>
          <MemoryRouter initialEntries={["/proj"]}>
            <Routes>
              <Route
                path="/:projectId"
                element={
                  <IssueTree
                    nodes={nodes}
                    doneNodes={treeDoneNodes}
                    derived={{}}
                    issues={treeIssues}
                    catalog={[]}
                    projectId="proj"
                  />
                }
              />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>,
      );
    });
  }

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    rowRenders.titles.length = 0;
    useIssueUiStore.setState({ expanded: { "epic-1": true } });
    client = new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: 60_000 },
        mutations: { retry: false },
      },
    });
    client.setQueryData(issuesKeys.projectPullRequests("proj"), { prs: {} });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    client.clear();
    useIssueUiStore.setState({ expanded });
  });

  it("re-renders only story rows whose PR data changed", async () => {
    renderTree(issues);
    takeTitles();

    const entryB = facts(2, 1);
    await act(async () => {
      client.setQueryData(issuesKeys.projectPullRequests("proj"), {
        prs: {
          "story-a": facts(1, 0),
          "story-b": entryB,
        },
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(takeTitles()).toEqual(["Story A", "Story B"]);
    expect(container.textContent).toContain("0 comments");
    expect(container.textContent).toContain("1 comment");

    await act(async () => {
      client.setQueryData(issuesKeys.projectPullRequests("proj"), {
        prs: {
          "story-a": facts(1, 4),
          "story-b": { ...entryB },
        },
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(takeTitles()).toEqual(["Story A"]);
    expect(container.textContent).toContain("4 comments");
    expect(container.textContent).toContain("1 comment");
  });

  it("mounts Done group rows only while the group is open, keeping their expand state", () => {
    useIssueUiStore.setState({
      expanded: { "epic-1": true, "epic-done": true, "story-done": false },
    });
    renderTree([...issues, doneEpic, doneStory, doneTask], doneNodes);
    const summary = container.querySelector<HTMLElement>(
      '[data-testid="structure-done-group"] summary',
    );
    if (!summary) throw new Error("no Done group summary");
    const doneTitles = () =>
      [
        ...container.querySelectorAll(
          '[data-testid="structure-done-group"] a[href*="/issues/"]',
        ),
      ].map((a) => a.textContent);

    expect(doneTitles()).toEqual([]);

    act(() => {
      summary.click();
    });
    expect(doneTitles()).toEqual(["Done Epic", "Done Story"]);

    act(() => {
      summary.click();
    });
    expect(doneTitles()).toEqual([]);

    act(() => {
      summary.click();
    });
    expect(doneTitles()).toEqual(["Done Epic", "Done Story"]);
  });
});
