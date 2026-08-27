// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DerivedState, IssueRecord } from "@server/schemas";
import type { FlowItem } from "../lib/flow";
import { skillPath } from "@/lib/plugin-paths";
import { FlowRowActions } from "./flow-row-actions";

const mutate = vi.fn();
const modelsState = vi.hoisted(() => ({
  models: [{ id: "composer-2.5", displayName: "Composer 2.5" }],
  isLoading: false,
}));

vi.mock("@/features/agents/api/queries", () => ({
  useAgentModelsQuery: () => ({
    data: { models: modelsState.models },
    isLoading: modelsState.isLoading,
  }),
}));

vi.mock("../api/mutations", () => ({
  useCreateChannelSession: (issueId: string, channel: string) => ({
    mutate: (...args: unknown[]) => {
      mutate(issueId, channel, ...args);
    },
    isPending: false,
  }),
  useUpdateIssue: () => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}));

vi.mock("../api/queries", () => ({
  useProjectPullRequestsQuery: () => ({
    data: undefined,
  }),
}));

vi.mock("../hooks/use-confirm-channel-live-run", () => ({
  useConfirmChannelLiveRun: () => ({
    confirmIfLiveRun: (action: () => void) => {
      action();
    },
    awaitingConfirm: false,
    confirming: false,
    dialog: null,
  }),
}));

const t0 = "2026-07-01T00:00:00.000Z";

function idea(id: string, stakeholder?: string): IssueRecord {
  return {
    id,
    kind: "idea",
    title: `Idea ${id}`,
    partOf: "project-a",
    order: 0,
    createdAt: t0,
    updatedAt: t0,
    archived: false,
    stakeholder,
  };
}

function story(id: string, prUrl?: string): IssueRecord {
  return {
    id,
    kind: "story",
    title: id,
    partOf: "project-a",
    order: 0,
    createdAt: t0,
    updatedAt: t0,
    branchName: id,
    merged: false,
    needsAttention: false,
    attentionReason: null,
    archived: false,
    prUrl,
  };
}

function flowItem(
  issue: IssueRecord,
  state?: DerivedState,
): FlowItem {
  return { issue, state };
}

function mountActions(item: FlowItem): {
  container: HTMLDivElement;
  root: Root;
} {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <MemoryRouter initialEntries={["/projects/project-a"]}>
        <FlowRowActions item={item} />
      </MemoryRouter>,
    );
  });
  return { container, root };
}

function buttonCount(container: HTMLElement): number {
  return container.querySelectorAll("button").length;
}

afterEach(() => {
  document.body.innerHTML = "";
  mutate.mockReset();
  modelsState.isLoading = false;
});

describe("FlowRowActions start planning", () => {
  it("shows begin planning only on captured Idea rows", () => {
    const captured = mountActions(
      flowItem(idea("capture-me"), { blocked: false, ideaStatus: "captured" }),
    );
    const startButton = captured.container.querySelector(
      '[data-testid="flow-row-start-planning"]',
    );
    expect(startButton).toBeTruthy();
    expect(startButton?.getAttribute("aria-label")).toBe("Begin planning");
    expect(startButton?.getAttribute("title")).toBe("Begin planning");
    expect(startButton?.closest("button")?.hasAttribute("disabled")).toBe(false);

    const planning = mountActions(
      flowItem(idea("planning"), { blocked: false, ideaStatus: "planning" }),
    );
    expect(
      planning.container.querySelector('[data-testid="flow-row-start-planning"]'),
    ).toBeNull();

    const storyRow = mountActions(
      flowItem(story("ship"), { blocked: false, storyStatus: "in-progress" }),
    );
    expect(
      storyRow.container.querySelector('[data-testid="flow-row-start-planning"]'),
    ).toBeNull();
  });

  it("posts to the planning channel sessions endpoint for that Idea", () => {
    const { container } = mountActions(
      flowItem(idea("capture-me"), { blocked: false, ideaStatus: "captured" }),
    );

    act(() => {
      (
        container.querySelector(
          '[data-testid="flow-row-start-planning"]',
        ) as HTMLButtonElement
      ).click();
    });

    expect(mutate).toHaveBeenCalledWith(
      "capture-me",
      "planning",
      {
        title: "Plan Idea capture-me",
        model: "composer-2.5",
        message:
          `Plan capture-me in the issue tracker using the issue-tracker-plan skill. Read ${skillPath("issue-tracker-plan")} and follow it.`,
      },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });

  it("renders nothing while planner models are loading", () => {
    modelsState.isLoading = true;
    const { container } = mountActions(
      flowItem(idea("capture-me"), { blocked: false, ideaStatus: "captured" }),
    );
    expect(buttonCount(container)).toBe(0);
  });
});

describe("FlowRowActions open PR", () => {
  it("shows labeled Open PR only when the Story has a prUrl", () => {
    const withPr = mountActions(
      flowItem(story("ship", "https://github.com/org/repo/pull/1"), {
        blocked: false,
        storyStatus: "in-progress",
      }),
    );
    const link = withPr.container.querySelector('a[href="https://github.com/org/repo/pull/1"]');
    expect(link).toBeTruthy();
    expect(link?.textContent).toContain("Open PR");

    const withoutPr = mountActions(
      flowItem(story("no-pr"), { blocked: false, storyStatus: "in-progress" }),
    );
    expect(withoutPr.container.querySelector('a[href^="http"]')).toBeNull();
  });
});

describe("FlowRowActions quiet buckets", () => {
  it("renders no controls for needs-attention, ready, or recently merged rows", () => {
    for (const item of [
      flowItem(story("attention"), {
        blocked: false,
        storyStatus: "in-progress",
      }),
      flowItem(story("ready"), { blocked: false, storyStatus: "ready" }),
      flowItem({ ...story("merged"), merged: true }, {
        blocked: false,
        storyStatus: "merged",
      }),
    ]) {
      const { container } = mountActions(item);
      expect(buttonCount(container)).toBe(0);
    }
  });
});
