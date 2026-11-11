// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DerivedState, DerivedWorktree, IssueDetail, IssueRecord } from "@server/schemas";
import { worktreeRemoveRetainedConfirm } from "../lib/worktree-card";
import { StoryWorktreeRow } from "./story-worktree-row";

const queryState = vi.hoisted(() => ({
  issues: [] as IssueRecord[],
  derived: {} as Record<string, DerivedState>,
  worktrees: {} as Record<string, DerivedWorktree>,
}));

function testSupplement(issues: IssueRecord[]) {
  return {
    byId: new Map(issues.map((i) => [i.id, i])),
    missingIds: [] as const,
    failedIds: new Set<string>(),
    accept: vi.fn(),
    reject: vi.fn(),
    listReady: true,
    messageFor: () => undefined as string | undefined,
  };
}

const removeMutate = vi.fn();

vi.mock("../api/queries", () => ({
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

function mountRow(issue: Extract<IssueDetail, { kind: "story" }>): {
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
              <StoryWorktreeRow
                issue={issue}
                projectId="issue-tracker"
                supplement={testSupplement(queryState.issues)}
                liveRun={queryState.derived[issue.id]?.liveRun === true}
              />
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

describe("StoryWorktreeRow", () => {
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
    const { container } = mountRow(issue);

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
});
