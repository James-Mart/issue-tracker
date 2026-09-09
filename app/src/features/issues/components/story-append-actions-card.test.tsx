// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DerivedState, IssueDetail } from "@server/schemas";
import {
  ADD_IDEA_HELPER,
  MERGED_APPEND_REASON,
  NO_BRANCH_MERGE_BASE_REASON,
} from "../lib/story-append-actions";
import { StoryAppendActionsCard } from "./story-append-actions-card";

const createMutate = vi.fn();
const updateMutate = vi.fn();
const updateFromMergeBaseMutate = vi.fn();
const navigate = vi.fn();

const derivedState = vi.hoisted(() => ({
  value: {} as Record<string, DerivedState>,
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>(
    "react-router-dom",
  );
  return {
    ...actual,
    useNavigate: () => navigate,
  };
});

vi.mock("../api/mutations", () => ({
  useCreateIssue: () => ({
    mutate: createMutate,
    isPending: false,
  }),
  useUpdateIssue: () => ({
    mutate: updateMutate,
    isPending: false,
  }),
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
    description: "",
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
  createMutate.mockReset();
  updateMutate.mockReset();
  updateFromMergeBaseMutate.mockReset();
  navigate.mockReset();
  derivedState.value = {};
});

describe("StoryAppendActionsCard enablement", () => {
  it("enables both actions on a PR-open Story", () => {
    derivedState.value = {
      "story-oauth-hardening": {
        blocked: false,
        storyStatus: "pr-open",
        mergeBase: "main @ c4d91e2",
      },
    };
    const { container } = mountCard(
      story({
        branchName: "story/oauth-hardening",
        prUrl: "https://github.com/acme/widgets/pull/412",
      }),
    );

    const idea = actionButton(container, "story-append-add-idea");
    const mergeBase = actionButton(container, "story-append-update-merge-base");
    expect(idea.disabled).toBe(false);
    expect(mergeBase.disabled).toBe(false);
    expect(
      container.querySelector('[data-testid="story-append-idea-helper"]')
        ?.textContent,
    ).toBe(ADD_IDEA_HELPER);
    expect(
      container.querySelector('[data-testid="story-append-merge-base-helper"]')
        ?.textContent,
    ).toContain("main @ c4d91e2");
    expect(
      container.querySelector('[data-testid="story-append-merge-base-helper"]')
        ?.textContent,
    ).toContain("story/oauth-hardening");
    expect(
      container.querySelector('[data-testid="story-append-card-reason"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="story-append-merge-base-reason"]'),
    ).toBeNull();
  });

  it("enables both actions on an in-progress Story with a branch", () => {
    derivedState.value = {
      "story-oauth-hardening": {
        blocked: false,
        storyStatus: "in-progress",
        mergeBase: "main @ c4d91e2",
      },
    };
    const { container } = mountCard(
      story({ branchName: "story/stack-rebase-helper" }),
    );

    expect(actionButton(container, "story-append-add-idea").disabled).toBe(
      false,
    );
    expect(
      actionButton(container, "story-append-update-merge-base").disabled,
    ).toBe(false);
    expect(
      container.querySelector('[data-testid="story-append-card-reason"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="story-append-merge-base-reason"]'),
    ).toBeNull();
  });

  it("keeps Add idea enabled and disables merge-base when the Story has no branch", () => {
    const { container } = mountCard(story({ id: "story-cli-auth-bootstrap" }));

    const idea = actionButton(container, "story-append-add-idea");
    const mergeBase = actionButton(container, "story-append-update-merge-base");
    expect(idea.disabled).toBe(false);
    expect(mergeBase.disabled).toBe(true);
    expect(
      container.querySelector('[data-testid="story-append-idea-helper"]')
        ?.textContent,
    ).toBe(ADD_IDEA_HELPER);
    expect(
      container.querySelector('[data-testid="story-append-merge-base-reason"]')
        ?.textContent,
    ).toBe(NO_BRANCH_MERGE_BASE_REASON);
    expect(
      container.querySelector('[data-testid="story-append-card-reason"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="story-append-merge-base-helper"]'),
    ).toBeNull();
  });

  it("disables both actions on a merged Story and puts the reason on the card", () => {
    const { container } = mountCard(
      story({
        id: "story-oauth-hardening-merged",
        merged: true,
        branchName: "story/session-cookie-rotation",
        prUrl: "https://github.com/acme/widgets/pull/389",
      }),
    );

    expect(actionButton(container, "story-append-add-idea").disabled).toBe(
      true,
    );
    expect(
      actionButton(container, "story-append-update-merge-base").disabled,
    ).toBe(true);
    expect(
      container.querySelector('[data-testid="story-append-card-reason"]')
        ?.textContent,
    ).toBe(MERGED_APPEND_REASON);
    expect(
      container.querySelector('[data-testid="story-append-idea-helper"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="story-append-merge-base-reason"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="story-append-merge-base-helper"]'),
    ).toBeNull();
  });
});

describe("StoryAppendActionsCard actions", () => {
  it("creates an Idea with appendTo and routes to it", () => {
    const { container } = mountCard(
      story({ branchName: "story/oauth-hardening" }),
    );

    createMutate.mockImplementation((_input, options) => {
      options?.onSuccess?.({ id: "idea-pr-redirect-review" });
    });
    updateMutate.mockImplementation((_input, options) => {
      options?.onSuccess?.();
    });

    act(() => {
      actionButton(container, "story-append-add-idea").click();
    });

    expect(createMutate).toHaveBeenCalledWith(
      {
        kind: "idea",
        title: "Append to OAuth callback hardening",
        partOf: "issue-tracker",
      },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
    expect(updateMutate).toHaveBeenCalledWith(
      {
        id: "idea-pr-redirect-review",
        patch: { appendTo: "story-oauth-hardening" },
      },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
    expect(navigate).toHaveBeenCalledWith(
      "/projects/issue-tracker/issues/idea-pr-redirect-review",
      expect.objectContaining({
        state: expect.objectContaining({
          issueBackStack: expect.any(Array),
        }),
      }),
    );
  });

  it("opens a confirm dialog that names both refs before calling the route", () => {
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

    const dialog = document.body.querySelector(
      '[data-testid="merge-base-confirm-dialog"]',
    );
    expect(dialog?.textContent).toContain("main @ c4d91e2");
    expect(dialog?.textContent).toContain("story/oauth-hardening");
    expect(updateFromMergeBaseMutate).not.toHaveBeenCalled();

    act(() => {
      (
        document.body.querySelector(
          '[data-testid="merge-base-confirm"]',
        ) as HTMLButtonElement
      ).click();
    });

    expect(updateFromMergeBaseMutate).toHaveBeenCalledOnce();
  });

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

  it("does not create an Idea when the Story is merged", () => {
    const { container } = mountCard(
      story({ merged: true, branchName: "story/landed" }),
    );

    act(() => {
      actionButton(container, "story-append-add-idea").click();
    });

    expect(createMutate).not.toHaveBeenCalled();
  });

  it("does not call update-from-merge-base when the Story has no branch", () => {
    const { container } = mountCard(story());

    act(() => {
      actionButton(container, "story-append-update-merge-base").click();
    });

    expect(updateFromMergeBaseMutate).not.toHaveBeenCalled();
  });
});
