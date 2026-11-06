// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DerivedState, IssueDetail } from "@server/schemas";
import { OverviewIconToolbar } from "./overview-icon-toolbar";

const updateFromMergeBaseMutate = vi.fn();

const derivedState = vi.hoisted(() => ({
  value: {} as Record<string, DerivedState>,
}));

vi.mock("../api/mutations", () => ({
  useCreateIssue: () => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn().mockResolvedValue({ id: "idea-1", kind: "idea" }),
    isPending: false,
  }),
  useUpdateIssue: () => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn().mockResolvedValue(undefined),
    isPending: false,
  }),
  useUpdateFromMergeBase: () => ({
    mutate: updateFromMergeBaseMutate,
    isPending: false,
  }),
  useEnqueueWorkRoot: () => ({ mutate: vi.fn(), isPending: false }),
  useParkWorkRoot: () => ({ mutate: vi.fn(), isPending: false }),
  useResumeParkedWorkRoot: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("@/features/agents/api/mutations", () => ({
  useSendConversationMessage: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("../api/queries", () => ({
  useIssuesQuery: () => ({
    data: { issues: [], derived: derivedState.value },
  }),
  useChannelSessionsQuery: () => ({
    data: [],
    isLoading: false,
    error: null,
  }),
}));

vi.mock("../hooks/use-issues-with-archived", () => ({
  useIssuesWithArchived: () => ({
    data: {
      issues: [],
      derived: {},
    },
  }),
}));

const noop = () => {};
vi.mock("../store/use-cockpit-launch-store", () => ({
  useCockpitLaunchStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      pending: null,
      beginLaunch: noop,
      ackLaunch: noop,
      failLaunch: noop,
      abandonLaunch: noop,
    }),
}));

const t0 = "2026-07-01T00:00:00.000Z";

function story(
  overrides: Partial<Extract<IssueDetail, { kind: "story" }>> = {},
): Extract<IssueDetail, { kind: "story" }> {
  return {
    id: "story-oauth-hardening",
    kind: "story",
    title: "OAuth callback hardening",
    partOf: "epic-a",
    order: 0,
    createdAt: t0,
    updatedAt: t0,
    archived: false,
    needsAttention: false,
    attentionReason: null,
    description: "",
    version: "1",
    labels: [],
    merged: false,
    reviewedTasks: [],
    ...overrides,
  };
}

function mountToolbar(issue: Extract<IssueDetail, { kind: "story" }>): {
  container: HTMLDivElement;
  root: Root;
} {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <MemoryRouter
        initialEntries={[`/projects/issue-tracker/issues/${issue.id}`]}
      >
        <Routes>
          <Route
            path="/projects/:projectId/issues/:id"
            element={
              <OverviewIconToolbar issue={issue} parentKind="epic" />
            }
          />
        </Routes>
      </MemoryRouter>,
    );
  });
  return { container, root };
}

function actionButton(
  container: ParentNode,
  testId: string,
): HTMLButtonElement {
  return container.querySelector(
    `[data-testid="${testId}"]`,
  ) as HTMLButtonElement;
}

afterEach(() => {
  document.body.innerHTML = "";
  updateFromMergeBaseMutate.mockReset();
  derivedState.value = {};
});

describe("OverviewIconToolbar merge base", () => {
  it("does not call update-from-merge-base when the confirm dialog is cancelled", () => {
    derivedState.value = {
      "story-oauth-hardening": {
        blocked: false,
        storyStatus: "in-progress",
        mergeBase: "main @ c4d91e2",
      },
    };
    const { container } = mountToolbar(
      story({ branchName: "story/oauth-hardening" }),
    );

    act(() => {
      actionButton(container, "overview-icon-toolbar-update-merge-base").click();
    });
    act(() => {
      const cancel = [...document.body.querySelectorAll("button")].find(
        (button) => button.textContent === "Cancel",
      );
      cancel?.click();
    });

    expect(updateFromMergeBaseMutate).not.toHaveBeenCalled();
  });
});
