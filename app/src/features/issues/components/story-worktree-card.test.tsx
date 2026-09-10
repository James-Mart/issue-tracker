// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DerivedState, DerivedWorktree, IssueDetail, IssueRecord } from "@server/schemas";
import { ApiError } from "@/lib/api/errors";
import {
  WORKTREE_PARENT_BRANCH_SUFFIX,
  WORKTREE_REMOVE_ACTIVE_CONFIRM,
  WORKTREE_REMOVE_DISABLED_REASON,
  WORKTREE_SETUP_FAILED_COPY,
  worktreeRemoveRetainedConfirm,
  worktreeRetainedCopy,
} from "../lib/worktree-card";
import { StoryWorktreeCard } from "./story-worktree-card";

const queryState = vi.hoisted(() => ({
  issues: [] as IssueRecord[],
  derived: {} as Record<string, DerivedState>,
}));

const removeMutate = vi.fn();
const setupMutate = vi.fn();

vi.mock("../api/queries", () => ({
  useIssuesQuery: () => ({
    data: { issues: queryState.issues, derived: queryState.derived },
  }),
}));

vi.mock("../api/mutations", () => ({
  useRemoveStoryWorktree: () => ({
    mutate: removeMutate,
    isPending: false,
  }),
  useSetupStoryWorktree: () => ({
    mutate: setupMutate,
    isPending: false,
  }),
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
    description: "",
    labels: [],
    merged: false,
    reviewedTasks: [],
    ...overrides,
  };
}

function parentStory(): IssueRecord {
  return {
    id: "story-cli-auth-bootstrap",
    kind: "story",
    title: "CLI auth bootstrap",
    partOf: "epic-a",
    order: 0,
    createdAt: t0,
    updatedAt: t0,
    archived: false,
    merged: false,
    reviewedTasks: [],
  };
}

function worktree(overrides: Partial<DerivedWorktree> = {}): DerivedWorktree {
  return {
    exists: false,
    uncommittedCount: 0,
    atRiskCommitCount: 0,
    retained: false,
    ...overrides,
  };
}

function seed(
  issue: Extract<IssueDetail, { kind: "story" }>,
  wt: DerivedWorktree | undefined,
  extras: IssueRecord[] = [],
  liveRun = false,
): void {
  queryState.issues = [issue, ...extras];
  queryState.derived = {
    [issue.id]: {
      blocked: false,
      liveRun,
      ...(wt ? { worktree: wt } : {}),
    },
  };
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
            element={<StoryWorktreeCard issue={issue} />}
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
  removeMutate.mockReset();
  setupMutate.mockReset();
  vi.unstubAllGlobals();
});

describe("StoryWorktreeCard", () => {
  it("renders nothing when the Story has no worktree and no blocked reason", () => {
    const issue = story();
    seed(issue, worktree());
    const { container } = mountCard(issue);
    expect(
      container.querySelector('[data-testid="story-worktree-card"]'),
    ).toBeNull();
  });

  it("renders nothing when derived worktree is absent", () => {
    const issue = story();
    seed(issue, undefined);
    const { container } = mountCard(issue);
    expect(
      container.querySelector('[data-testid="story-worktree-card"]'),
    ).toBeNull();
  });

  it("renders the parent-branch blocked state and names the stacked-on Story", () => {
    const issue = story({
      id: "story-device-login-flow",
      title: "Device login flow",
      stackedOn: "story-cli-auth-bootstrap",
    });
    seed(
      issue,
      worktree({ blockedReason: "parent-branch" }),
      [parentStory()],
    );
    const { container } = mountCard(issue);
    const card = container.querySelector('[data-testid="story-worktree-card"]');
    expect(card?.getAttribute("data-state")).toBe("parent-branch");
    expect(card?.textContent).toContain("Blocked");
    expect(
      container.querySelector('[data-testid="story-worktree-parent-branch"]')
        ?.textContent,
    ).toBe(`CLI auth bootstrap ${WORKTREE_PARENT_BRANCH_SUFFIX}`);
    expect(container.textContent).not.toContain("story/device-login");
    expect(container.textContent).not.toMatch(/merge base/i);
    expect(
      container.querySelector('[data-testid="story-worktree-remove"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="story-worktree-retry"]'),
    ).toBeNull();
  });

  it("renders setup-failed with output and log path", () => {
    const issue = story();
    seed(
      issue,
      worktree({
        exists: true,
        path: PATH,
        setupFailed: true,
        setupOutput: "npm ERR! Missing script: \"prepare-workspace\"",
        setupLogPath: "/root/issue-tracker-worktrees/issue-tracker/story-oauth-hardening.setup.log",
      }),
    );
    const { container } = mountCard(issue);
    const card = container.querySelector('[data-testid="story-worktree-card"]');
    expect(card?.getAttribute("data-state")).toBe("setup-failed");
    expect(card?.textContent).toContain("Blocked");
    expect(card?.textContent).toContain(WORKTREE_SETUP_FAILED_COPY);
    expect(
      container.querySelector('[data-testid="story-worktree-path"]')
        ?.textContent,
    ).toBe(PATH);
    expect(
      container.querySelector('[data-testid="story-worktree-setup-output"]')
        ?.textContent,
    ).toContain("prepare-workspace");
    expect(
      container.querySelector('[data-testid="story-worktree-setup-log-path"]')
        ?.textContent,
    ).toBe(
      "/root/issue-tracker-worktrees/issue-tracker/story-oauth-hardening.setup.log",
    );
    expect(
      container.querySelector('[data-testid="story-worktree-retry"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="story-worktree-remove"]'),
    ).toBeNull();
  });

  it("renders retained with uncommitted and at-risk counts", () => {
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
    const card = container.querySelector('[data-testid="story-worktree-card"]');
    expect(card?.getAttribute("data-state")).toBe("retained");
    expect(card?.textContent).toContain("Retained");
    expect(
      container.querySelector('[data-testid="story-worktree-retained-copy"]')
        ?.textContent,
    ).toBe(worktreeRetainedCopy(2, 1));
    expect(
      container.querySelector('[data-testid="story-worktree-path"]')
        ?.textContent,
    ).toBe(PATH);
  });

  it("renders active with a mono path and copy affordance", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", {
      ...navigator,
      clipboard: { writeText },
    });
    const issue = story({ branchName: "story/oauth-hardening" });
    seed(issue, worktree({ exists: true, path: PATH }));
    const { container } = mountCard(issue);
    const card = container.querySelector('[data-testid="story-worktree-card"]');
    expect(card?.getAttribute("data-state")).toBe("active");
    expect(card?.textContent).toContain("Active");
    expect(
      container.querySelector('[data-testid="story-worktree-path"]')
        ?.textContent,
    ).toBe(PATH);
    expect(container.textContent).not.toContain("story/oauth-hardening");

    await act(async () => {
      (
        container.querySelector(
          '[data-testid="story-worktree-copy"]',
        ) as HTMLButtonElement
      ).click();
    });
    expect(writeText).toHaveBeenCalledWith(PATH);
  });

  it("confirms active remove without discard", () => {
    const issue = story();
    seed(issue, worktree({ exists: true, path: PATH }));
    const { container } = mountCard(issue);

    act(() => {
      actionButton(container, "story-worktree-remove").click();
    });
    const dialog = document.body.querySelector(
      '[data-testid="remove-worktree-confirm-dialog"]',
    );
    expect(dialog?.textContent).toContain(WORKTREE_REMOVE_ACTIVE_CONFIRM);
    expect(
      document.body.querySelector('[data-testid="remove-worktree-confirm-path"]')
        ?.textContent,
    ).toBe(PATH);
    expect(removeMutate).not.toHaveBeenCalled();

    act(() => {
      actionButton(document.body, "remove-worktree-confirm").click();
    });
    expect(removeMutate).toHaveBeenCalledWith({}, expect.any(Object));
  });

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

  it("does not post remove when the confirmation is cancelled", () => {
    const issue = story();
    seed(issue, worktree({ exists: true, path: PATH }));
    const { container } = mountCard(issue);

    act(() => {
      actionButton(container, "story-worktree-remove").click();
    });
    act(() => {
      const cancel = [...document.body.querySelectorAll("button")].find(
        (button) => button.textContent === "Cancel",
      );
      cancel?.click();
    });
    expect(removeMutate).not.toHaveBeenCalled();
  });

  it("disables remove beside a readable reason while a live run holds the Story", () => {
    const issue = story();
    seed(issue, worktree({ exists: true, path: PATH }), [], true);
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

  it("retries setup and the card becomes active when setup succeeds", () => {
    const issue = story();
    seed(
      issue,
      worktree({
        exists: true,
        path: PATH,
        setupFailed: true,
        setupOutput: "npm ERR! Missing script: \"prepare-workspace\"",
      }),
    );
    const { container, root } = mountCard(issue);
    expect(
      container.querySelector('[data-testid="story-worktree-card"]')
        ?.getAttribute("data-state"),
    ).toBe("setup-failed");

    act(() => {
      actionButton(container, "story-worktree-retry").click();
    });
    expect(setupMutate).toHaveBeenCalledOnce();

    seed(issue, worktree({ exists: true, path: PATH }));
    act(() => {
      root.render(
        <MemoryRouter
          initialEntries={[`/projects/issue-tracker/issues/${issue.id}`]}
        >
          <Routes>
            <Route
              path="/projects/:projectId/issues/:id"
              element={<StoryWorktreeCard issue={issue} />}
            />
          </Routes>
        </MemoryRouter>,
      );
    });
    expect(
      container.querySelector('[data-testid="story-worktree-card"]')
        ?.getAttribute("data-state"),
    ).toBe("active");
    expect(
      container.querySelector('[data-testid="story-worktree-retry"]'),
    ).toBeNull();
  });

  it("renders a 409 from remove on the card", () => {
    const issue = story();
    seed(issue, worktree({ exists: true, path: PATH }));
    const { container } = mountCard(issue);
    const message =
      'worktree remove refuses Story "story-oauth-hardening": 1 uncommitted change(s), 0 at-risk commit(s)';
    removeMutate.mockImplementation(
      (_input, opts: { onError?: (err: Error) => void }) => {
        opts.onError?.(new ApiError(message, 409, { error: message }));
      },
    );

    act(() => {
      actionButton(container, "story-worktree-remove").click();
    });
    act(() => {
      actionButton(document.body, "remove-worktree-confirm").click();
    });

    expect(
      container.querySelector('[data-testid="story-worktree-conflict"]')
        ?.textContent,
    ).toBe(message);
    expect(
      container.querySelector('[data-testid="story-worktree-card"]'),
    ).not.toBeNull();
  });

  it("renders a 409 from retry on the card", () => {
    const issue = story();
    seed(
      issue,
      worktree({
        exists: true,
        path: PATH,
        setupFailed: true,
        setupOutput: "npm ERR! Missing script: \"prepare-workspace\"",
      }),
    );
    const { container } = mountCard(issue);
    const message =
      'setup command failed for Story "story-oauth-hardening" (exit 1); see /tmp/setup.log';
    setupMutate.mockImplementation(
      (_input, opts: { onError?: (err: Error) => void }) => {
        opts.onError?.(new ApiError(message, 409, { error: message }));
      },
    );

    act(() => {
      actionButton(container, "story-worktree-retry").click();
    });

    expect(
      container.querySelector('[data-testid="story-worktree-conflict"]')
        ?.textContent,
    ).toBe(message);
    expect(
      container.querySelector('[data-testid="story-worktree-card"]')
        ?.getAttribute("data-state"),
    ).toBe("setup-failed");
  });
});
