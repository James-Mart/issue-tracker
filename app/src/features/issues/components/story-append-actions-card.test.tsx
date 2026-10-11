// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DerivedState, IssueDetail } from "@server/schemas";
import { StoryAppendActionsCard } from "./story-append-actions-card";

const updateFromMergeBaseMutate = vi.fn();

const derivedState = vi.hoisted(() => ({
  value: {} as Record<string, DerivedState>,
}));

vi.mock("../api/mutations", () => ({
  useCreateIssue: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateIssue: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateFromMergeBase: () => ({
    mutate: updateFromMergeBaseMutate,
    isPending: false,
  }),
}));

vi.mock("../api/queries", () => ({
  useIssuesQuery: () => ({
    data: { issues: [], derived: derivedState.value },
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

function mountCard(issue: Extract<IssueDetail, { kind: "story" }>): {
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
            element={<StoryAppendActionsCard issue={issue} />}
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
  return container.querySelector(`[data-testid="${testId}"]`) as HTMLButtonElement;
}

afterEach(() => {
  document.body.innerHTML = "";
  updateFromMergeBaseMutate.mockReset();
  derivedState.value = {};
});

describe("StoryAppendActionsCard actions", () => {
  it("does not call update-from-merge-base when the confirm dialog is cancelled", () => {
    derivedState.value = {
      "story-oauth-hardening": {
        blocked: false,
        storyStatus: "in-progress",
        mergeBase: "main @ c4d91e2",
      },
    };
    const { container } = mountCard(
      story({ branchName: "story/oauth-hardening" }),
    );

    act(() => {
      actionButton(container, "story-append-update-merge-base").click();
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
