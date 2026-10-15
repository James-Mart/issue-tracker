// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DerivedState, IssueDetail, IssueRecord } from "@server/schemas";
import { GitStackPanel } from "./git-stack-panel";

vi.mock("../api/mutations", () => ({
  useUpdateIssue: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>(
    "react-router-dom",
  );
  return { ...actual, useParams: () => ({ projectId: "platform" }) };
});

vi.mock("@/features/reviews/components/story-code-review-row", () => ({
  StoryCodeReviewRow: () => null,
}));

const t0 = "2026-08-10T12:00:00.000Z";

const project: IssueRecord = {
  kind: "project",
  id: "platform",
  title: "Platform",
  trunk: "develop",
  mergePolicy: "pull-request",
  maxImplementingRuns: 1,
  order: 0,
  createdAt: t0,
  updatedAt: t0,
};

function story(
  overrides: Partial<Extract<IssueDetail, { kind: "story" }>> = {},
): Extract<IssueDetail, { kind: "story" }> {
  return {
    kind: "story",
    id: "root-story",
    title: "Root",
    partOf: "platform",
    order: 0,
    archived: false,
    needsAttention: false,
    attentionReason: null,
    merged: false,
    reviewedTasks: [],
    branchName: "story/root",
    createdAt: t0,
    updatedAt: t0,
    description: "",
    version: "v1",
    ...overrides,
  };
}

const queryState: {
  issues: IssueRecord[];
  derived: Record<string, DerivedState>;
} = {
  issues: [project],
  derived: {},
};

vi.mock("../api/queries", () => ({
  useIssuesQuery: () => ({
    data: {
      issues: queryState.issues,
      derived: queryState.derived,
      problems: [],
    },
  }),
  useIssueDetailQuery: () => ({ data: undefined, error: null }),
}));

function mount(ui: React.ReactElement): { container: HTMLDivElement; root: Root } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(ui);
  });
  return { container, root };
}

afterEach(() => {
  document.body.innerHTML = "";
  queryState.issues = [project];
  queryState.derived = {};
});

describe("GitStackPanel merge base", () => {
  it("replaces the read-only merge-base row on a project-level root story", () => {
    queryState.derived = {
      "root-story": {
        blocked: false,
        mergeBase: "feature-base",
        mergeSettingsLock: { locked: false },
      },
    };
    const { container } = mount(<GitStackPanel issue={story()} />);
    const button = container.querySelector("[data-testid=merge-base-field] button");

    expect(button).toBeInstanceOf(HTMLButtonElement);
    expect(button?.textContent).toContain("develop (project trunk)");
    expect(container.textContent).not.toContain("feature-base");
    expect(container.textContent).toContain("Merge policy");
    expect(container.textContent).toContain("Inherit (Pull request)");
    expect(container.textContent).toContain("story/root");
  });
});
