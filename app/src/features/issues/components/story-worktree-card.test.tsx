// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DerivedState, DerivedWorktree, IssueDetail, IssueRecord } from "@server/schemas";
import {
  WORKTREE_REMOVE_DISABLED_REASON,
  worktreeRemoveRetainedConfirm,
} from "../lib/worktree-card";
import { StoryWorktreeCard } from "./story-worktree-card";

const queryState = vi.hoisted(() => ({
  issues: [] as IssueRecord[],
  derived: {} as Record<string, DerivedState>,
  worktrees: {} as Record<string, DerivedWorktree>,
}));

const removeMutate = vi.fn();

vi.mock("../api/queries", () => ({
  useIssuesQuery: () => ({
    data: { issues: queryState.issues, derived: queryState.derived },
  }),
  useProjectWorktreesQuery: () => ({
    data: { worktrees: queryState.worktrees },
    isError: false,
    error: undefined,
  }),
}));

vi.mock("../api/mutations", () => ({
  useRemoveStoryWorktree: () => ({
    mutate: removeMutate,
    isPending: false,
  }),
  useSetupStoryWorktree: () => ({ mutate: vi.fn(), isPending: false }),
}));

const t0 = "2026-07-01T00:00:00.000Z";
const PATH = "/root/issue-tracker-worktrees/issue-tracker/story-oauth-hardening";

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

function worktree(overrides: Partial<DerivedWorktree> = {}): DerivedWorktree {
  return {
    exists: false,
    uncommittedCount: 0,
    atRiskCommitCount: 0,
    retained: false,
    locked: false,
    ...overrides,
  };
}

function seed(
  issue: Extract<IssueDetail, { kind: "story" }>,
  wt: DerivedWorktree,
  liveRun = false,
): void {
  queryState.issues = [issue];
  queryState.derived = {
    [issue.id]: {
      blocked: false,
      liveRun,
    },
  };
  queryState.worktrees = { [issue.id]: wt };
}

function actionButton(
  root: ParentNode,
  testId: string,
): HTMLButtonElement {
  return root.querySelector(`[data-testid="${testId}"]`) as HTMLButtonElement;
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
            element={
              <StoryWorktreeCard issue={issue} projectId="issue-tracker" />
            }
          />
        </Routes>
      </MemoryRouter>,
    );
  });
  return { container, root };
}

afterEach(() => {
  document.body.innerHTML = "";
  queryState.issues = [];
  queryState.derived = {};
  queryState.worktrees = {};
  removeMutate.mockReset();
});

describe("StoryWorktreeCard", () => {
  it("confirms retained remove with discard and the named counts", () => {
    const issue = story({ merged: true });
    seed(
      issue,
      worktree({
        exists: true,
        path: PATH,
        retained: true,
        uncommittedCount: 2,
        atRiskCommitCount: 1,
      }),
    );
    const { container } = mountCard(issue);

    act(() => {
      actionButton(container, "story-worktree-remove").click();
    });
    const dialog = document.body.querySelector(
      '[data-testid="remove-worktree-confirm-dialog"]',
    );
    expect(dialog?.textContent).toContain(worktreeRemoveRetainedConfirm(2, 1));
    expect(removeMutate).not.toHaveBeenCalled();

    act(() => {
      actionButton(document.body, "remove-worktree-confirm").click();
    });
    expect(removeMutate).toHaveBeenCalledWith(
      { discard: true },
      expect.any(Object),
    );
  });

  it("disables remove beside a readable reason while a live run holds the Story", () => {
    const issue = story();
    seed(issue, worktree({ exists: true, path: PATH }), true);
    const { container } = mountCard(issue);

    const remove = actionButton(container, "story-worktree-remove");
    expect(remove.disabled).toBe(true);
    expect(remove.getAttribute("aria-describedby")).toBe(
      "story-worktree-remove-reason",
    );
    expect(
      container.querySelector('[data-testid="story-worktree-remove-reason"]')
        ?.textContent,
    ).toBe(WORKTREE_REMOVE_DISABLED_REASON);

    act(() => {
      remove.click();
    });
    expect(
      document.body.querySelector(
        '[data-testid="remove-worktree-confirm-dialog"]',
      ),
    ).toBeNull();
    expect(removeMutate).not.toHaveBeenCalled();
  });
});
